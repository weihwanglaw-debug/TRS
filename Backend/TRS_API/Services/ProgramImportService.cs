using System.Globalization;
using System.IO.Compression;
using System.Security.Claims;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.EntityFrameworkCore;
using TRS_API.Models;
using TRS_Data.Models;

namespace TRS_API.Services;

public sealed class ProgramImportService
{
    private const int HeaderRow = 5;
    private const int FirstDataRow = 6;
    private const int MaxRows = 1000;
    private const string EntrySheetName = "Participant Entries";
    private const string InfoSheetName = "Template Info";
    private const string RowTypeHeader = "Row Type";
    private const string SampleRowType = "SAMPLE";

    private readonly TRSDbContext _db;
    private readonly RegistrationWorkflowService _registrationWorkflow;
    private readonly AdminPaymentOutcomeService _adminPaymentOutcome;
    private readonly IMemoryCache _cache;

    public ProgramImportService(
        TRSDbContext db,
        RegistrationWorkflowService registrationWorkflow,
        AdminPaymentOutcomeService adminPaymentOutcome,
        IMemoryCache cache)
    {
        _db = db;
        _registrationWorkflow = registrationWorkflow;
        _adminPaymentOutcome = adminPaymentOutcome;
        _cache = cache;
    }

    public async Task<ProgramImportPreviewResponse> PreviewAsync(
        int eventId,
        int programId,
        IFormFile file,
        ClaimsPrincipal user,
        CancellationToken ct)
    {
        var response = new ProgramImportPreviewResponse { EventId = eventId, ProgramId = programId };

        if (file.Length == 0)
        {
            response.Errors.Add(Issue(null, null, null, "EMPTY_FILE", "The uploaded file is empty."));
            return response;
        }

        if (!file.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
        {
            response.Errors.Add(Issue(null, null, null, "INVALID_FILE", "Upload the Excel .xlsx template file."));
            return response;
        }

        var ev = await _db.Events.AsNoTracking().FirstOrDefaultAsync(e => e.EventId == eventId, ct);
        var program = await _db.Programs
            .Include(p => p.Fields)
            .Include(p => p.CustomFields)
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.EventId == eventId && p.ProgramId == programId, ct);

        if (ev == null || program == null)
        {
            response.Errors.Add(Issue(null, null, null, "NOT_FOUND", "Event or program not found."));
            return response;
        }

        response.EventName = ev.Name;
        response.ProgramName = program.Name;

        ImportedWorkbook workbook;
        await using (var stream = file.OpenReadStream())
        {
            workbook = ReadWorkbook(stream);
        }

        ValidateTemplateScope(workbook, eventId, programId, response.Errors);

        var rows = ReadRows(workbook, response.Errors);
        response.RowCount = rows.Count;

        var request = BuildRequest(ev, program, rows, GetAdminContact(user), response.Errors, response.Warnings);
        var existingParticipantKeys = await GetExistingParticipantKeysAsync(program.ProgramId, ct);
        ValidateImportedRows(program, rows, existingParticipantKeys, response.Errors);
        response.EntryCount = request.Groups.Count;
        response.ParticipantCount = request.Groups.Sum(g => g.Participants.Count);
        response.Entries = request.Groups
            .Select(g => new ProgramImportPreviewEntry
            {
                EntryNo = rows.FirstOrDefault(r => r.ParticipantsGroupKey == g)?.EntryNo ?? "",
                ParticipantCount = g.Participants.Count,
                Names = string.Join(" / ", g.Participants.Select(p => p.FullName)),
                Fee = g.Fee,
            })
            .ToList();

        if (response.Errors.Count == 0)
        {
            var validation = await _registrationWorkflow.ValidateAndPriceAsync(
                request,
                new RegistrationValidationOptions
                {
                    RegistrationGateMode = EventRegistrationGateMode.AdminAssisted,
                    ValidatePricingAgainstCurrentPrograms = true,
                },
                ct);

            if (!validation.Success)
            {
                response.Errors.Add(Issue(null, null, null, validation.Code ?? "VALIDATION_FAILED", validation.Message));
            }
            else
            {
                response.TotalAmount = validation.Value?.TotalAmount ?? 0m;
                request.Payment.Amount = response.TotalAmount;
                var token = Guid.NewGuid().ToString("N");
                _cache.Set(token, new PendingProgramImport(request, response.EntryCount, response.ParticipantCount),
                    TimeSpan.FromMinutes(30));
                response.ImportToken = token;
            }
        }

        response.Valid = response.Errors.Count == 0;
        return response;
    }

    public async Task<RegistrationWorkflowResult<ProgramImportConfirmResponse>> ConfirmAsync(
        int eventId,
        int programId,
        ProgramImportConfirmRequest req,
        CancellationToken ct)
    {
        if (!_cache.TryGetValue(req.ImportToken, out PendingProgramImport? pending) || pending == null)
            return RegistrationWorkflowResult<ProgramImportConfirmResponse>.Fail("IMPORT_EXPIRED", "Import preview has expired. Please upload the file again.");

        if (pending.Request.EventId != eventId || pending.Request.Groups.Any(g => g.ProgramId != programId))
            return RegistrationWorkflowResult<ProgramImportConfirmResponse>.Fail("IMPORT_MISMATCH", "Import token does not match this event/program.");

        var outcome = _adminPaymentOutcome.Normalize(req.PaymentStatus, req.Method, req.PaymentReference);
        if (!outcome.Success)
            return RegistrationWorkflowResult<ProgramImportConfirmResponse>.Fail(outcome.Code!, outcome.Message);

        var create = await _registrationWorkflow.CreateAsync(
            pending.Request,
            new RegistrationPersistOptions
            {
                RegistrationGateMode = EventRegistrationGateMode.AdminAssisted,
                ValidatePricingAgainstCurrentPrograms = true,
                PaymentGateway = "Manual",
                PaymentMethod = outcome.Value!.Method,
                PaymentStatus = outcome.Value.PaymentStatus,
                AdminNote = req.AdminNote.Trim(),
                ReceiptNumber = outcome.Value.PaymentReference,
                SuppressReceiptEmail = true,
            },
            ct);

        if (!create.Success)
            return RegistrationWorkflowResult<ProgramImportConfirmResponse>.Fail(create.Code!, create.Message);

        _cache.Remove(req.ImportToken);

        return RegistrationWorkflowResult<ProgramImportConfirmResponse>.Ok(new ProgramImportConfirmResponse
        {
            RegistrationId = create.Value!.RegistrationId,
            PaymentId = create.Value.PaymentId,
            EntryCount = pending.EntryCount,
            ParticipantCount = pending.ParticipantCount,
            PaymentStatus = create.Value.PaymentStatus,
        });
    }

    private static CreateRegistrationRequest BuildRequest(
        Event ev,
        TrsProgram program,
        List<ImportedRow> rows,
        AdminContact admin,
        List<ProgramImportIssue> errors,
        List<ProgramImportIssue> warnings)
    {
        var request = new CreateRegistrationRequest
        {
            EventId = ev.EventId,
            EventName = ev.Name,
            ContactName = admin.Name,
            ContactEmail = admin.Email,
            ContactPhone = "",
            Payment = new CreatePaymentDto
            {
                Gateway = "Manual",
                Method = "Others",
                Currency = "SGD",
            },
        };

        if (!rows.Any())
            errors.Add(Issue(null, null, null, "NO_ROWS", "No participant rows found in the import sheet."));

        var customMap = BuildCustomFieldMap(program, errors);

        foreach (var groupRows in rows.GroupBy(r => r.EntryNo.Trim(), StringComparer.OrdinalIgnoreCase))
        {
            var entryNo = groupRows.Key;
            if (string.IsNullOrWhiteSpace(entryNo))
                continue;

            var rowList = groupRows.OrderBy(r => r.RowNumber).ToList();
            var participants = new List<CreateParticipantDto>();

            foreach (var row in rowList)
            {
                ValidateRequired(row, "Full Name", row.FullName, errors);
                ValidateRequired(row, "Date of Birth", row.Dob, errors);
                ValidateRequired(row, "Gender", row.Gender, errors);
                ValidateRequired(row, "Email", row.Email, errors);
                ValidateRequired(row, "Contact Number", row.ContactNumber, errors);
                ValidateRequired(row, "Nationality", row.Nationality, errors);
                ValidateRequired(row, "Club / Team / School", row.ClubSchoolCompany, errors);

                var participant = new CreateParticipantDto
                {
                    FullName = row.FullName,
                    Dob = row.Dob,
                    Gender = row.Gender,
                    Email = row.Email,
                    ContactNumber = row.ContactNumber,
                    Nationality = row.Nationality,
                    ClubSchoolCompany = row.ClubSchoolCompany,
                    TshirtSize = row.TshirtSize,
                    SbaId = row.SbaId,
                    GuardianName = row.GuardianName,
                    GuardianContact = row.GuardianContact,
                    Remark = row.Remark,
                };

                foreach (var (label, value) in row.CustomValues)
                {
                    if (customMap.TryGetValue(label, out var customFieldId))
                    {
                        participant.CustomFieldValues[customFieldId] = value;
                    }
                    else if (!string.IsNullOrWhiteSpace(value))
                    {
                        warnings.Add(Issue(row.RowNumber, entryNo, label, "UNKNOWN_CUSTOM_FIELD", $"Custom field '{label}' is not configured for this program and will be ignored."));
                    }
                }

                participants.Add(participant);
            }

            var fee = program.PaymentRequired
                ? program.Fee * (string.Equals(program.FeeStructure, "per_player", StringComparison.OrdinalIgnoreCase) ? participants.Count : 1)
                : 0m;

            var group = new CreateGroupDto
            {
                ProgramId = program.ProgramId,
                ProgramName = program.Name,
                Fee = fee,
                Participants = participants,
            };
            request.Groups.Add(group);

            foreach (var row in rowList)
                row.ParticipantsGroupKey = group;
        }

        request.Payment.Amount = request.Groups.Sum(g => g.Fee);
        return request;
    }

    private static void ValidateRequired(ImportedRow row, string field, string? value, List<ProgramImportIssue> errors)
    {
        if (string.IsNullOrWhiteSpace(value))
            errors.Add(Issue(row.RowNumber, row.EntryNo, field, "MISSING_REQUIRED_FIELD", $"{field} is required."));
    }

    private static void ValidateTemplateScope(ImportedWorkbook workbook, int eventId, int programId, List<ProgramImportIssue> errors)
    {
        var info = workbook.Sheets.GetValueOrDefault(InfoSheetName) ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var templateEventId = FindInfoValue(info, "Event ID") ?? FindParticipantMeta(workbook, "Event ID");
        var templateProgramId = FindInfoValue(info, "Program ID") ?? FindParticipantMeta(workbook, "Program ID");

        if (!int.TryParse(templateEventId, out var parsedEventId) || parsedEventId != eventId)
            errors.Add(Issue(null, null, "Event ID", "TEMPLATE_EVENT_MISMATCH", "Template Event ID does not match the selected event."));

        if (!int.TryParse(templateProgramId, out var parsedProgramId) || parsedProgramId != programId)
            errors.Add(Issue(null, null, "Program ID", "TEMPLATE_PROGRAM_MISMATCH", "Template Program ID does not match the selected program."));
    }

    private static string? FindInfoValue(Dictionary<string, string> info, string key)
    {
        foreach (var (cellKey, value) in info)
        {
            if (string.Equals(cellKey, key, StringComparison.OrdinalIgnoreCase))
                return value;
        }
        return null;
    }

    private static string? FindParticipantMeta(ImportedWorkbook workbook, string key)
    {
        var sheet = workbook.Sheets.GetValueOrDefault(EntrySheetName);
        if (sheet == null) return null;
        return sheet.Values.FirstOrDefault(value => value.StartsWith($"{key}:", StringComparison.OrdinalIgnoreCase))
            ?.Split(':', 2)[1].Trim();
    }

    private async Task<HashSet<string>> GetExistingParticipantKeysAsync(int programId, CancellationToken ct)
    {
        var existing = await _db.ParticipantGroups
            .AsNoTracking()
            .Where(g =>
                g.ProgramId == programId &&
                g.GroupStatus != StatusCodesEx.Registration.Cancelled &&
                g.Registration.RegStatus != StatusCodesEx.Registration.Cancelled)
            .SelectMany(g => g.Participants
                .Where(p => p.ParticipantStatus != StatusCodesEx.Participant.Cancelled)
                .Select(p => new
                {
                    p.FullName,
                    p.DateOfBirth,
                }))
            .ToListAsync(ct);

        return existing
            .Where(p => !string.IsNullOrWhiteSpace(p.FullName) && p.DateOfBirth.HasValue)
            .Select(p => ParticipantKey(p.FullName, p.DateOfBirth!.Value))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static void ValidateImportedRows(
        TrsProgram program,
        List<ImportedRow> rows,
        HashSet<string> existingParticipantKeys,
        List<ProgramImportIssue> errors)
    {
        var submittedParticipantKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var requiredCustomFields = program.CustomFields
            .Where(cf => cf.IsRequired)
            .GroupBy(cf => cf.Label.Trim(), StringComparer.OrdinalIgnoreCase)
            .Where(g => !string.IsNullOrWhiteSpace(g.Key) && g.Count() == 1)
            .Select(g => g.First())
            .ToList();

        foreach (var groupRows in rows.GroupBy(r => r.EntryNo.Trim(), StringComparer.OrdinalIgnoreCase))
        {
            var entryNo = groupRows.Key;
            if (string.IsNullOrWhiteSpace(entryNo))
                continue;

            var rowList = groupRows.OrderBy(r => r.RowNumber).ToList();
            if (rowList.Count < program.MinPlayers || rowList.Count > program.MaxPlayers)
            {
                errors.Add(Issue(
                    rowList.First().RowNumber,
                    entryNo,
                    "Entry No",
                    "INVALID_PARTICIPANT_COUNT",
                    $"'{program.Name}' requires between {program.MinPlayers} and {program.MaxPlayers} participants per entry."));
            }

            foreach (var row in rowList)
            {
                ValidateProgramFieldRequirements(program, row, errors);
                ValidateCustomFieldRequirements(requiredCustomFields, row, errors);

                if (TryParseImportDate(row.Dob, out var dob))
                {
                    var age = CalculateAge(dob.Value);
                    if (age < program.MinAge || age > program.MaxAge)
                    {
                        errors.Add(Issue(row.RowNumber, entryNo, "Date of Birth", "INVALID_AGE", $"'{row.FullName}' does not meet the age requirement for '{program.Name}'."));
                    }

                    if (!string.IsNullOrWhiteSpace(row.FullName))
                    {
                        var key = ParticipantKey(row.FullName, dob.Value);
                        if (!submittedParticipantKeys.Add(key))
                            errors.Add(Issue(row.RowNumber, entryNo, "Full Name", "DUPLICATE_REGISTRATION", $"Duplicate participant '{row.FullName}' appears in this import."));
                        if (existingParticipantKeys.Contains(key))
                            errors.Add(Issue(row.RowNumber, entryNo, "Full Name", "DUPLICATE_REGISTRATION", $"'{row.FullName}' is already registered for '{program.Name}'."));
                    }
                }

                if (string.Equals(program.Gender, "Male", StringComparison.OrdinalIgnoreCase)
                    && !string.IsNullOrWhiteSpace(row.Gender)
                    && !string.Equals(row.Gender, "Male", StringComparison.OrdinalIgnoreCase))
                {
                    errors.Add(Issue(row.RowNumber, entryNo, "Gender", "INVALID_GENDER", $"'{program.Name}' is for male participants only."));
                }

                if (string.Equals(program.Gender, "Female", StringComparison.OrdinalIgnoreCase)
                    && !string.IsNullOrWhiteSpace(row.Gender)
                    && !string.Equals(row.Gender, "Female", StringComparison.OrdinalIgnoreCase))
                {
                    errors.Add(Issue(row.RowNumber, entryNo, "Gender", "INVALID_GENDER", $"'{program.Name}' is for female participants only."));
                }
            }

            if (string.Equals(program.Gender, "Mixed", StringComparison.OrdinalIgnoreCase))
            {
                var maleCount = rowList.Count(r => string.Equals(r.Gender, "Male", StringComparison.OrdinalIgnoreCase));
                var femaleCount = rowList.Count(r => string.Equals(r.Gender, "Female", StringComparison.OrdinalIgnoreCase));
                if (maleCount != 1 || femaleCount != 1)
                    errors.Add(Issue(rowList.First().RowNumber, entryNo, "Gender", "INVALID_GENDER", $"'{program.Name}' requires exactly one male and one female participant."));
            }
        }
    }

    private static void ValidateProgramFieldRequirements(TrsProgram program, ImportedRow row, List<ProgramImportIssue> errors)
    {
        var fields = program.Fields;
        if (fields == null) return;

        if (fields.EnableTshirt && fields.RequireTshirt)
            ValidateRequired(row, "T-Shirt Size", row.TshirtSize, errors);
        if (fields.EnableGuardianInfo && fields.RequireGuardianInfo)
        {
            ValidateRequired(row, "Guardian Name", row.GuardianName, errors);
            ValidateRequired(row, "Guardian Contact Number", row.GuardianContact, errors);
        }
        if (fields.EnableSbaId && fields.RequireSbaId)
            ValidateRequired(row, "SBA ID", row.SbaId, errors);
        if (fields.EnableRemark && fields.RequireRemark)
            ValidateRequired(row, "Remark", row.Remark, errors);
    }

    private static void ValidateCustomFieldRequirements(
        List<ProgramCustomField> requiredCustomFields,
        ImportedRow row,
        List<ProgramImportIssue> errors)
    {
        foreach (var customField in requiredCustomFields)
        {
            row.CustomValues.TryGetValue(customField.Label, out var value);
            ValidateRequired(row, customField.Label, value, errors);
        }
    }

    private static List<ImportedRow> ReadRows(ImportedWorkbook workbook, List<ProgramImportIssue> errors)
    {
        var sheet = workbook.CellTables.GetValueOrDefault(EntrySheetName);
        if (sheet == null)
        {
            errors.Add(Issue(null, null, null, "SHEET_NOT_FOUND", $"'{EntrySheetName}' sheet was not found."));
            return new();
        }

        var headers = sheet
            .Where(c => c.Row == HeaderRow)
            .ToDictionary(c => c.Column, c => CleanHeader(c.Value));

        foreach (var duplicate in headers.Values
            .Where(h => !string.IsNullOrWhiteSpace(h))
            .GroupBy(h => h, StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Count() > 1))
        {
            errors.Add(Issue(HeaderRow, null, duplicate.Key, "DUPLICATE_COLUMN", $"Column '{duplicate.Key}' appears more than once. Rename duplicate columns before importing."));
        }

        if (!headers.Values.Contains("Entry No", StringComparer.OrdinalIgnoreCase))
            errors.Add(Issue(HeaderRow, null, "Entry No", "MISSING_COLUMN", "Entry No column is required."));

        var rows = new List<ImportedRow>();
        for (var rowNumber = FirstDataRow; rowNumber < FirstDataRow + MaxRows; rowNumber++)
        {
            var values = sheet
                .Where(c => c.Row == rowNumber)
                .ToDictionary(c => c.Column, c => c.Value);

            if (values.Count == 0)
                continue;

            var byHeader = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (columnIndex, header) in headers)
            {
                if (string.IsNullOrWhiteSpace(header) || !values.TryGetValue(columnIndex, out var value))
                    continue;

                if (!byHeader.ContainsKey(header))
                    byHeader[header] = value.Trim();
            }

            if (byHeader.Values.All(string.IsNullOrWhiteSpace))
                continue;

            if (string.Equals(Value(byHeader, RowTypeHeader), SampleRowType, StringComparison.OrdinalIgnoreCase))
                continue;

            var dobValue = Value(byHeader, "Date of Birth");
            var normalizedDob = NormalizeDate(dobValue, out var validDate);
            if (!validDate)
                errors.Add(Issue(rowNumber, Value(byHeader, "Entry No"), "Date of Birth", "INVALID_DATE_FORMAT", "Date of Birth must use yyyy-mm-dd or a valid Excel date."));

            var row = new ImportedRow
            {
                RowNumber = rowNumber,
                EntryNo = Value(byHeader, "Entry No"),
                FullName = Value(byHeader, "Full Name"),
                Dob = normalizedDob,
                Gender = Value(byHeader, "Gender"),
                Email = Value(byHeader, "Email"),
                ContactNumber = Value(byHeader, "Contact Number"),
                Nationality = NormalizeNationality(Value(byHeader, "Nationality")),
                ClubSchoolCompany = Value(byHeader, "Club / Team / School"),
                TshirtSize = Value(byHeader, "T-Shirt Size"),
                SbaId = Value(byHeader, "SBA ID"),
                GuardianName = Value(byHeader, "Guardian Name"),
                GuardianContact = Value(byHeader, "Guardian Contact Number"),
                Remark = Value(byHeader, "Remark"),
            };

            if (string.IsNullOrWhiteSpace(row.EntryNo))
                errors.Add(Issue(rowNumber, null, "Entry No", "MISSING_REQUIRED_FIELD", "Entry No is required."));

            foreach (var (header, cellValue) in byHeader)
            {
                if (IsKnownHeader(header)) continue;
                row.CustomValues[header] = cellValue;
            }

            rows.Add(row);
        }

        return rows;
    }

    private static bool IsKnownHeader(string header) => new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        RowTypeHeader, "Entry No", "Full Name", "Date of Birth", "Gender", "Email", "Contact Number", "Nationality",
        "Club / Team / School", "T-Shirt Size", "SBA ID", "Guardian Name", "Guardian Contact Number", "Remark"
    }.Contains(header);

    private static string CleanHeader(string value) => Regex.Replace(value, @"\s*\*$", "").Trim();

    private static string Value(Dictionary<string, string> values, string key) =>
        values.TryGetValue(key, out var value) ? value.Trim() : "";

    private static string NormalizeNationality(string value)
    {
        var clean = value.Trim();
        var dash = clean.IndexOf(" - ", StringComparison.Ordinal);
        return dash > 0 ? clean[..dash].Trim() : clean;
    }

    private static string NormalizeDate(string value, out bool valid)
    {
        var clean = value.Trim();
        valid = true;
        if (string.IsNullOrWhiteSpace(clean)) return "";

        if (DateTime.TryParse(clean, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var dt))
            return dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        if (double.TryParse(clean, NumberStyles.Number, CultureInfo.InvariantCulture, out var serial) && serial > 0)
        {
            try
            {
                return DateTime.FromOADate(serial).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            }
            catch
            {
                valid = false;
                return clean;
            }
        }

        valid = false;
        return clean;
    }

    private static bool TryParseImportDate(string? value, out DateTime? dob)
    {
        dob = null;
        if (string.IsNullOrWhiteSpace(value))
            return false;

        if (!DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsed))
            return false;

        dob = parsed.Date;
        return true;
    }

    private static int CalculateAge(DateTime dob)
    {
        var today = DateTime.UtcNow.Date;
        var age = today.Year - dob.Year;
        if (dob.Date > today.AddYears(-age)) age--;
        return age;
    }

    private static string ParticipantKey(string? fullName, DateTime dob) =>
        $"{fullName?.Trim()}|{dob:yyyy-MM-dd}";

    private static string ParticipantKey(string? fullName, DateOnly dob) =>
        $"{fullName?.Trim()}|{dob:yyyy-MM-dd}";

    private static Dictionary<string, string> BuildCustomFieldMap(TrsProgram program, List<ProgramImportIssue> errors)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var customField in program.CustomFields)
        {
            var label = customField.Label.Trim();
            if (string.IsNullOrWhiteSpace(label))
                continue;

            if (map.ContainsKey(label))
            {
                errors.Add(Issue(null, null, label, "DUPLICATE_CUSTOM_FIELD", $"Program custom field label '{label}' is duplicated. Rename the custom fields before importing."));
                continue;
            }

            map[label] = customField.CustomFieldId.ToString();
        }

        return map;
    }

    private static AdminContact GetAdminContact(ClaimsPrincipal user)
    {
        var email = user.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Email)?.Value
            ?? user.FindFirst(ClaimTypes.Email)?.Value
            ?? "";
        var name = user.FindFirst("name")?.Value?.Trim();
        return new AdminContact(
            string.IsNullOrWhiteSpace(name) ? (string.IsNullOrWhiteSpace(email) ? "Admin" : email) : name,
            email);
    }

    private static ProgramImportIssue Issue(int? row, string? entryNo, string? field, string code, string message) => new()
    {
        Row = row,
        EntryNo = entryNo,
        Field = field,
        Code = code,
        Message = message,
    };

    private static ImportedWorkbook ReadWorkbook(Stream stream)
    {
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);
        var sharedStrings = ReadSharedStrings(archive);
        var sheets = ReadSheetNames(archive);
        var workbook = new ImportedWorkbook();

        foreach (var (sheetName, path) in sheets)
        {
            var table = ReadSheetCells(archive, path, sharedStrings);
            workbook.CellTables[sheetName] = table;
            workbook.Sheets[sheetName] = ToKeyValueTable(table);
        }

        return workbook;
    }

    private static List<string> ReadSharedStrings(ZipArchive archive)
    {
        var entry = archive.GetEntry("xl/sharedStrings.xml");
        if (entry == null) return new();
        using var stream = entry.Open();
        var doc = XDocument.Load(stream);
        XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        return doc.Descendants(ns + "si")
            .Select(si => string.Concat(si.Descendants(ns + "t").Select(t => t.Value)))
            .ToList();
    }

    private static List<(string SheetName, string Path)> ReadSheetNames(ZipArchive archive)
    {
        XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        XNamespace relNs = "http://schemas.openxmlformats.org/package/2006/relationships";
        XNamespace officeRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

        using var workbookStream = archive.GetEntry("xl/workbook.xml")!.Open();
        var workbook = XDocument.Load(workbookStream);
        using var relStream = archive.GetEntry("xl/_rels/workbook.xml.rels")!.Open();
        var rels = XDocument.Load(relStream);
        var relMap = rels.Descendants(relNs + "Relationship")
            .ToDictionary(
                r => r.Attribute("Id")?.Value ?? "",
                r => "xl/" + (r.Attribute("Target")?.Value ?? "").TrimStart('/'));

        return workbook.Descendants(main + "sheet")
            .Select(sheet =>
            {
                var name = sheet.Attribute("name")?.Value ?? "";
                var relId = sheet.Attribute(officeRel + "id")?.Value ?? "";
                return (name, relMap.GetValueOrDefault(relId, ""));
            })
            .Where(x => !string.IsNullOrWhiteSpace(x.name) && !string.IsNullOrWhiteSpace(x.Item2))
            .ToList();
    }

    private static List<ImportedCell> ReadSheetCells(ZipArchive archive, string path, List<string> sharedStrings)
    {
        var entry = archive.GetEntry(path);
        if (entry == null) return new();
        using var stream = entry.Open();
        var doc = XDocument.Load(stream);
        XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        var cells = new List<ImportedCell>();

        foreach (var cell in doc.Descendants(ns + "c"))
        {
            var reference = cell.Attribute("r")?.Value ?? "";
            var (col, row) = ParseCellReference(reference);
            if (row <= 0 || col < 0) continue;

            var type = cell.Attribute("t")?.Value;
            var raw = cell.Element(ns + "v")?.Value ?? "";
            var value = raw;
            if (type == "s" && int.TryParse(raw, out var sharedIndex) && sharedIndex >= 0 && sharedIndex < sharedStrings.Count)
                value = sharedStrings[sharedIndex];
            else if (type == "inlineStr")
                value = string.Concat(cell.Descendants(ns + "t").Select(t => t.Value));

            cells.Add(new ImportedCell(row, col, value));
        }

        return cells;
    }

    private static Dictionary<string, string> ToKeyValueTable(List<ImportedCell> cells)
    {
        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var byRow = cells.GroupBy(c => c.Row);
        foreach (var row in byRow)
        {
            var ordered = row.OrderBy(c => c.Column).ToList();
            for (var i = 0; i + 1 < ordered.Count; i += 2)
            {
                var key = ordered[i].Value.Trim();
                var value = ordered[i + 1].Value.Trim();
                if (!string.IsNullOrWhiteSpace(key) && !dict.ContainsKey(key))
                    dict[key] = value;
            }
        }
        return dict;
    }

    private static (int Column, int Row) ParseCellReference(string reference)
    {
        var match = Regex.Match(reference, @"^([A-Z]+)(\d+)$", RegexOptions.IgnoreCase);
        if (!match.Success) return (-1, -1);
        var column = 0;
        foreach (var ch in match.Groups[1].Value.ToUpperInvariant())
            column = column * 26 + (ch - 'A' + 1);
        return (column - 1, int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture));
    }

    private sealed record PendingProgramImport(CreateRegistrationRequest Request, int EntryCount, int ParticipantCount);
    private sealed record AdminContact(string Name, string Email);
    private sealed record ImportedCell(int Row, int Column, string Value);

    private sealed class ImportedWorkbook
    {
        public Dictionary<string, Dictionary<string, string>> Sheets { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, List<ImportedCell>> CellTables { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private sealed class ImportedRow
    {
        public int RowNumber { get; init; }
        public string EntryNo { get; init; } = "";
        public string FullName { get; init; } = "";
        public string Dob { get; init; } = "";
        public string Gender { get; init; } = "";
        public string Email { get; init; } = "";
        public string ContactNumber { get; init; } = "";
        public string Nationality { get; init; } = "";
        public string ClubSchoolCompany { get; init; } = "";
        public string TshirtSize { get; init; } = "";
        public string SbaId { get; init; } = "";
        public string GuardianName { get; init; } = "";
        public string GuardianContact { get; init; } = "";
        public string Remark { get; init; } = "";
        public Dictionary<string, string> CustomValues { get; } = new(StringComparer.OrdinalIgnoreCase);
        public CreateGroupDto? ParticipantsGroupKey { get; set; }
    }
}
