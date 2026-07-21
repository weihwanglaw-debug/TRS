using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using System.ComponentModel.DataAnnotations;
using TRS_API.Models;
using TRS_Data.Models;

namespace TRS_API.Services;

public class RegistrationWorkflowService
{
    private static readonly EmailAddressAttribute ContactEmailValidator = new();

    private readonly TRSDbContext _db;
    private readonly ILogger<RegistrationWorkflowService> _log;
    private readonly IBackgroundJobQueue _jobQueue;
    private readonly IServiceScopeFactory _serviceScopeFactory;
    private readonly AdminPaymentOutcomeService _adminPaymentOutcome;

    public RegistrationWorkflowService(
        TRSDbContext db,
        ILogger<RegistrationWorkflowService> log,
        IBackgroundJobQueue jobQueue,
        IServiceScopeFactory serviceScopeFactory,
        AdminPaymentOutcomeService adminPaymentOutcome)
    {
        _db = db;
        _log = log;
        _jobQueue = jobQueue;
        _serviceScopeFactory = serviceScopeFactory;
        _adminPaymentOutcome = adminPaymentOutcome;
    }

    public async Task<RegistrationWorkflowResult<PricingQuote>> ValidateAndPriceAsync(
        CreateRegistrationRequest req,
        RegistrationValidationOptions? options = null,
        CancellationToken ct = default)
    {
        options ??= new RegistrationValidationOptions();

        var eventEntity = await _db.Events
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.EventId == req.EventId, ct);

        if (eventEntity == null || !eventEntity.IsActive)
            return RegistrationWorkflowResult<PricingQuote>.Fail("EVENT_NOT_FOUND", "Event not found.");

        if (string.IsNullOrWhiteSpace(req.ContactName))
            return RegistrationWorkflowResult<PricingQuote>.Fail("MISSING_REQUIRED_FIELD", "Contact name is required.");

        if (string.IsNullOrWhiteSpace(req.ContactEmail) || !ContactEmailValidator.IsValid(req.ContactEmail))
            return RegistrationWorkflowResult<PricingQuote>.Fail("MISSING_REQUIRED_FIELD", "A valid contact email is required.");

        if (req.Groups == null || req.Groups.Count == 0)
            return RegistrationWorkflowResult<PricingQuote>.Fail("INVALID_REGISTRATION", "At least one program is required.");

        var programIds = req.Groups.Select(g => g.ProgramId).Distinct().ToList();
        var activeProgramCount = await _db.Programs
            .CountAsync(p => p.EventId == req.EventId && p.IsActive, ct);
        var registrationStatus = ComputeRegistrationStatus(eventEntity, activeProgramCount);
        var gateFailure = ValidateEventGate(options.RegistrationGateMode, registrationStatus);
        if (gateFailure != null)
            return RegistrationWorkflowResult<PricingQuote>.Fail(gateFailure.Value.Code, gateFailure.Value.Message);

        var programs = await _db.Programs
            .Include(p => p.Fields)
            .Include(p => p.CustomFields)
            .Where(p => p.EventId == req.EventId && programIds.Contains(p.ProgramId))
            .ToDictionaryAsync(p => p.ProgramId, ct);

        if (programIds.Any(id => !programs.ContainsKey(id)))
            return RegistrationWorkflowResult<PricingQuote>.Fail("PROGRAM_NOT_FOUND", "One or more selected programs could not be found.");

        var activeCounts = await GetActiveProgramSlotCountsAsync(programs.Values, ct);

        var fixtureProgramIds = await _db.Fixtures
            .Where(f => programIds.Contains(f.ProgramId))
            .Select(f => f.ProgramId)
            .Distinct()
            .ToListAsync(ct);
        var fixturePrograms = fixtureProgramIds.ToHashSet();

        var existingParticipants = await _db.ParticipantGroups
            .Where(g =>
                programIds.Contains(g.ProgramId) &&
                g.GroupStatus != StatusCodesEx.Registration.Cancelled &&
                g.Registration.RegStatus != StatusCodesEx.Registration.Cancelled)
            .SelectMany(g => g.Participants
                .Where(p => p.ParticipantStatus != StatusCodesEx.Participant.Cancelled)
                .Select(p => new ExistingParticipantIdentity
            {
                ProgramId = g.ProgramId,
                FullName = p.FullName,
                DateOfBirth = p.DateOfBirth,
            }))
            .ToListAsync(ct);

        var requestedPerProgram = req.Groups
            .GroupBy(g => g.ProgramId)
            .ToDictionary(g => g.Key, g => g.Sum(group =>
                IsPerPlayer(programs[g.Key].FeeStructure) ? group.Participants.Count : 1));

        var quoteGroups = new List<PricingQuoteGroup>();
        var submittedParticipantIdentities = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var submittedTeamNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var group in req.Groups)
        {
            var program = programs[group.ProgramId];
            NormalizeGroupClubValues(group, program);

            if (!program.IsActive || program.Status == StatusCodesEx.Program.Closed)
                return RegistrationWorkflowResult<PricingQuote>.Fail("PROGRAM_CLOSED", $"'{program.Name}' is no longer accepting registrations.");

            if (fixturePrograms.Contains(program.ProgramId))
                return RegistrationWorkflowResult<PricingQuote>.Fail("PROGRAM_FIXTURE_EXISTS", $"'{program.Name}' already has a fixture generated and is no longer accepting registrations.");

            var activeCount = activeCounts.GetValueOrDefault(group.ProgramId);
            var requestedCount = requestedPerProgram[group.ProgramId];
            if (activeCount + requestedCount > program.MaxParticipants)
                return RegistrationWorkflowResult<PricingQuote>.Fail("PROGRAM_FULL", $"'{program.Name}' does not have enough remaining slots.");

            var participantValidation = ValidateParticipants(group, program, existingParticipants);
            if (!participantValidation.Success)
                return RegistrationWorkflowResult<PricingQuote>.Fail(participantValidation.Code!, participantValidation.Message);

            foreach (var participant in group.Participants)
            {
                var dob = ParseDob(participant.Dob);
                var participantKey = $"{program.ProgramId}|{participant.FullName?.Trim()}|{dob:yyyy-MM-dd}";
                if (!submittedParticipantIdentities.Add(participantKey))
                    return RegistrationWorkflowResult<PricingQuote>.Fail("DUPLICATE_REGISTRATION", $"Duplicate participant detected in '{program.Name}'.");
            }

            if (ProgramTypeRules.IsTeamProgram(program.Type))
            {
                var teamName = NormalizeTeamName(group.Participants.FirstOrDefault()?.ClubSchoolCompany);
                var teamKey = $"{program.ProgramId}|{teamName}";
                if (!submittedTeamNames.Add(teamKey))
                    return RegistrationWorkflowResult<PricingQuote>.Fail("DUPLICATE_TEAM", $"Team '{teamName}' is already included for '{program.Name}'.");

                var existingTeamName = await FindDuplicateTeamNameAsync(program.ProgramId, teamName, ct);
                if (existingTeamName)
                    return RegistrationWorkflowResult<PricingQuote>.Fail("DUPLICATE_TEAM", $"Team '{teamName}' is already registered for '{program.Name}'.");
            }

            var expectedFee = program.PaymentRequired
                ? program.Fee * (string.Equals(program.FeeStructure, "per_player", StringComparison.OrdinalIgnoreCase)
                    ? group.Participants.Count
                    : 1)
                : 0m;

            if (options.ValidatePricingAgainstCurrentPrograms && group.Fee != expectedFee)
                return RegistrationWorkflowResult<PricingQuote>.Fail("PRICE_MISMATCH", $"'{program.Name}' pricing no longer matches the latest configuration.");

            quoteGroups.Add(new PricingQuoteGroup
            {
                ProgramId = group.ProgramId,
                ProgramName = program.Name,
                ExpectedFee = expectedFee,
                PaymentRequired = program.PaymentRequired,
                FeeStructure = program.FeeStructure,
                ParticipantCount = group.Participants.Count,
            });
        }

        var expectedTotal = quoteGroups.Sum(g => g.ExpectedFee);
        if (options.ValidatePricingAgainstCurrentPrograms && req.Payment.Amount != expectedTotal)
            return RegistrationWorkflowResult<PricingQuote>.Fail("PRICE_MISMATCH", "Registration total no longer matches the latest pricing.");

        return RegistrationWorkflowResult<PricingQuote>.Ok(new PricingQuote
        {
            EventId = eventEntity.EventId,
            EventName = eventEntity.Name,
            Currency = string.IsNullOrWhiteSpace(req.Payment.Currency) ? "SGD" : req.Payment.Currency,
            TotalAmount = expectedTotal,
            Groups = quoteGroups,
        });
    }

    public async Task<RegistrationWorkflowResult<RegistrationCreateOutcome>> CreateAsync(
        CreateRegistrationRequest req,
        RegistrationPersistOptions options,
        CancellationToken ct = default)
    {
        var pricing = await ValidateAndPriceAsync(req, new RegistrationValidationOptions
        {
            RegistrationGateMode = options.RegistrationGateMode,
            ValidatePricingAgainstCurrentPrograms = options.ValidatePricingAgainstCurrentPrograms,
        }, ct);

        if (!pricing.Success)
            return RegistrationWorkflowResult<RegistrationCreateOutcome>.Fail(pricing.Code!, pricing.Message);

        using var tx = await _db.Database.BeginTransactionAsync(ct);

        try
        {
            var programIds = req.Groups.Select(g => g.ProgramId).Distinct().ToList();
            var customFields = await _db.ProgramCustomFields
                .Where(cf => programIds.Contains(cf.ProgramId))
                .ToListAsync(ct);
            var customFieldsByProgram = customFields
                .GroupBy(cf => cf.ProgramId)
                .ToDictionary(
                    g => g.Key,
                    g => g.ToList());

            var programs = await _db.Programs
                .Include(p => p.Fields)
                .Include(p => p.CustomFields)
                .Where(p => p.EventId == req.EventId && programIds.Contains(p.ProgramId))
                .ToDictionaryAsync(p => p.ProgramId, ct);

            var createsConfirmedRegistration = IsAdminConfirmedPaymentStatus(options.PaymentStatus);
            var reg = new EventRegistration
            {
                EventId = pricing.Value!.EventId,
                EventName = pricing.Value.EventName,
                RegStatus = createsConfirmedRegistration ? StatusCodesEx.Registration.Confirmed : StatusCodesEx.Registration.Pending,
                ContactName = req.ContactName,
                ContactEmail = req.ContactEmail,
                ContactPhone = req.ContactPhone,
                SubmittedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow,
                TotalAmount = options.PaymentAmountOverride ?? pricing.Value.TotalAmount,
                Currency = pricing.Value.Currency,
                RegistrationStatus = createsConfirmedRegistration ? StatusCodesEx.Registration.Confirmed : StatusCodesEx.Registration.Pending,
                ConfirmedAt = createsConfirmedRegistration ? DateTime.UtcNow : null,
            };
            _db.EventRegistrations.Add(reg);
            await _db.SaveChangesAsync(ct);

            var createdGroups = new List<ParticipantGroup>();
            var pendingItems = new List<PendingPaymentItem>();

            foreach (var groupDto in req.Groups)
            {
                var program = await _db.Programs
                    .FromSqlRaw("SELECT * FROM Programs WITH (UPDLOCK, ROWLOCK) WHERE ProgramID = {0}", groupDto.ProgramId)
                    .FirstOrDefaultAsync(ct);

                if (program == null || program.EventId != req.EventId)
                    return await RollbackAndFail(tx, "PROGRAM_NOT_FOUND", "One or more selected programs could not be found.");

                if (!program.IsActive || program.Status == StatusCodesEx.Program.Closed)
                    return await RollbackAndFail(tx, "PROGRAM_CLOSED", $"'{program.Name}' is no longer accepting registrations.");

                var fixtureExists = await _db.Fixtures.AnyAsync(f => f.ProgramId == groupDto.ProgramId, ct);
                if (fixtureExists)
                    return await RollbackAndFail(tx, "PROGRAM_FIXTURE_EXISTS", $"'{program.Name}' already has a fixture generated and is no longer accepting registrations.");

                var incomingSlotCount = IsPerPlayer(program.FeeStructure) ? groupDto.Participants.Count : 1;
                var activeSlotCount = await CountActiveProgramSlotsAsync(program, ct);

                if (activeSlotCount + incomingSlotCount > program.MaxParticipants)
                    return await RollbackAndFail(tx, "PROGRAM_FULL", $"'{program.Name}' is full. No slots remaining.");

                NormalizeGroupClubValues(groupDto, program);

                var duplicateCheck = await FindDuplicateAsync(groupDto, program, ct);
                if (duplicateCheck)
                {
                    var teamName = ProgramTypeRules.IsTeamProgram(program.Type)
                        ? NormalizeTeamName(groupDto.Participants.FirstOrDefault()?.ClubSchoolCompany)
                        : null;
                    var message = teamName == null
                        ? $"One or more participants are already registered for '{program.Name}'."
                        : $"Team '{teamName}' or one of its participants is already registered for '{program.Name}'.";
                    return await RollbackAndFail(tx, "DUPLICATE_REGISTRATION", message);
                }

                var persistedGroupFee = options.ValidatePricingAgainstCurrentPrograms
                    ? pricing.Value.Groups.First(g => g.ProgramId == groupDto.ProgramId).ExpectedFee
                    : groupDto.Fee;

                var group = new ParticipantGroup
                {
                    RegistrationId = reg.RegistrationId,
                    EventId = req.EventId,
                    ProgramId = groupDto.ProgramId,
                    ProgramName = program.Name,
                    Fee = persistedGroupFee,
                    GroupStatus = createsConfirmedRegistration ? StatusCodesEx.Registration.Confirmed : StatusCodesEx.Registration.Pending,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = createsConfirmedRegistration ? DateTime.UtcNow : null,
                };
                _db.ParticipantGroups.Add(group);
                await _db.SaveChangesAsync(ct);

                var createdParticipants = new List<Participant>();
                foreach (var participantDto in groupDto.Participants)
                {
                    var participant = new Participant
                    {
                        GroupId = group.GroupId,
                        FullName = participantDto.FullName,
                        DateOfBirth = ParseDob(participantDto.Dob),
                        Gender = participantDto.Gender,
                        Nationality = participantDto.Nationality,
                        ClubSchoolCompany = participantDto.ClubSchoolCompany,
                        Email = participantDto.Email,
                        ContactNumber = participantDto.ContactNumber,
                        TshirtSize = participantDto.TshirtSize,
                        SbaId = participantDto.SbaId,
                        GuardianName = participantDto.GuardianName,
                        GuardianContact = participantDto.GuardianContact,
                        DocumentUrl = participantDto.DocumentUrl,
                        Remark = participantDto.Remark,
                        CreatedAt = DateTime.UtcNow,
                    };
                    _db.Participants.Add(participant);
                    createdParticipants.Add(participant);
                }
                await _db.SaveChangesAsync(ct);

                var customFieldLookup = customFieldsByProgram.GetValueOrDefault(groupDto.ProgramId)
                    ?? new List<ProgramCustomField>();

                for (var pi = 0; pi < groupDto.Participants.Count; pi++)
                {
                    foreach (var (key, value) in groupDto.Participants[pi].CustomFieldValues)
                    {
                        var customField = ResolveCustomField(customFieldLookup, key);
                        if (customField == null)
                        {
                            _log.LogWarning("Custom field key '{Key}' not found for program {ProgramId} - skipping", key, groupDto.ProgramId);
                            continue;
                        }

                        _db.ParticipantCustomFieldValues.Add(new ParticipantCustomFieldValue
                        {
                            ParticipantId = createdParticipants[pi].ParticipantId,
                            CustomFieldId = customField.CustomFieldId,
                            FieldLabel = customField.Label,
                            FieldValue = value,
                        });
                    }
                }

                group.ClubDisplay = createdParticipants.FirstOrDefault()?.ClubSchoolCompany ?? "";
                group.NamesDisplay = string.Join(" / ", createdParticipants.Select(p => p.FullName));

                if (string.Equals(program.FeeStructure, "per_player", StringComparison.OrdinalIgnoreCase))
                {
                    for (var pi = 0; pi < createdParticipants.Count; pi++)
                    {
                        pendingItems.Add(new PendingPaymentItem
                        {
                            GroupId = group.GroupId,
                            EventId = req.EventId,
                            ProgramId = groupDto.ProgramId,
                            ProgramName = program.Name,
                            Description = $"{program.Name} - {createdParticipants[pi].FullName}",
                            PlayerName = createdParticipants[pi].FullName,
                            Amount = options.ValidatePricingAgainstCurrentPrograms
                                ? (program.PaymentRequired ? program.Fee : 0m)
                                : ResolveSnapshotPerPlayerAmount(groupDto),
                            ParticipantId = createdParticipants[pi].ParticipantId,
                        });
                    }
                }
                else
                {
                    pendingItems.Add(new PendingPaymentItem
                    {
                        GroupId = group.GroupId,
                        EventId = req.EventId,
                        ProgramId = groupDto.ProgramId,
                        ProgramName = program.Name,
                        Description = $"{program.Name} - {string.Join(" / ", createdParticipants.Select(p => p.FullName))}",
                        Amount = persistedGroupFee,
                    });
                }

                createdGroups.Add(group);
            }

            var isConfirmed = IsAdminConfirmedPaymentStatus(options.PaymentStatus);
            var receiptProgramId = pendingItems
                .Select(i => (int?)i.ProgramId)
                .Where(pid => pid.HasValue)
                .Distinct()
                .OrderBy(pid => pid)
                .FirstOrDefault();
            var isManualAdminPayment = IsManualAdminPaymentGateway(options.PaymentGateway) && isConfirmed;
            var receiptNo = !isManualAdminPayment && options.PaymentStatus == StatusCodesEx.Payment.Success
                ? options.ReceiptNumber ?? ReceiptNumberGenerator.Generate(req.EventId, receiptProgramId)
                : options.ReceiptNumber;
            var payment = new Payment
            {
                RegistrationId = reg.RegistrationId,
                EventId = req.EventId,
                PaymentGateway = options.PaymentGateway,
                PaymentMethod = options.PaymentMethod,
                Amount = options.PaymentAmountOverride ?? pricing.Value.TotalAmount,
                Currency = pricing.Value.Currency,
                PaymentStatus = options.PaymentStatus,
                AdminNote = options.AdminNote,
                GatewaySessionId = options.GatewaySessionId,
                GatewayPaymentId = options.GatewayPaymentId,
                ReceiptNumber = receiptNo,
                CreatedAt = DateTime.UtcNow,
                PaidAt = options.PaymentStatus == StatusCodesEx.Payment.Success ? DateTime.UtcNow : null,
            };

            if (isManualAdminPayment)
            {
                _adminPaymentOutcome.ApplyOutcome(
                    payment,
                    new AdminPaymentOutcome(options.PaymentStatus, options.PaymentMethod, options.PaymentReference),
                    options.AdminNote,
                    receiptProgramId);
            }
            _db.Payments.Add(payment);
            await _db.SaveChangesAsync(ct);

            foreach (var item in pendingItems)
            {
                _db.PaymentItems.Add(new PaymentItem
                {
                    PaymentId = payment.PaymentId,
                    GroupId = item.GroupId,
                    EventId = item.EventId,
                    ProgramId = item.ProgramId,
                    ProgramName = item.ProgramName,
                    Description = item.Description,
                    PlayerName = item.PlayerName,
                    Amount = item.Amount,
                    ItemStatus = options.PaymentStatus == StatusCodesEx.Payment.Success ? StatusCodesEx.PaymentItem.Success : StatusCodesEx.PaymentItem.Pending,
                    CreatedAt = DateTime.UtcNow,
                    ParticipantId = item.ParticipantId,
                });
            }

            await _db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);

            if (options.PaymentStatus == StatusCodesEx.Payment.Success && !options.SuppressReceiptEmail)
                await QueueReceiptEmailAsync(reg.RegistrationId, payment.PaymentId);

            return RegistrationWorkflowResult<RegistrationCreateOutcome>.Ok(new RegistrationCreateOutcome
            {
                RegistrationId = reg.RegistrationId,
                PaymentId = payment.PaymentId,
                TotalAmount = payment.Amount,
                PaymentStatus = payment.PaymentStatus,
            });
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(ct);
            _log.LogError(ex, "Error creating registration for event {EventId}", req.EventId);
            return RegistrationWorkflowResult<RegistrationCreateOutcome>.Fail("CREATE_FAILED", "Failed to save registration.");
        }
    }

    private async Task<bool> FindDuplicateAsync(CreateGroupDto group, TrsProgram program, CancellationToken ct)
    {

               // Step 1: Server-side — EF translates these two predicates fine
        var existingParticipants = await _db.ParticipantGroups
            .Where(g =>
                g.ProgramId == program.ProgramId &&
                g.GroupStatus != StatusCodesEx.Registration.Cancelled &&
                g.Registration.RegStatus != StatusCodesEx.Registration.Cancelled)
            .SelectMany(g => g.Participants
                .Where(p => p.ParticipantStatus != StatusCodesEx.Participant.Cancelled)
                .Select(p => new
            {
                p.FullName,
                p.DateOfBirth
            }))
            .ToListAsync(ct);

        // Step 2: Client-side — plain LINQ against two in-memory lists
        var incoming = group.Participants
            .Select(p => new
            {
                p.FullName,
                Dob = ParseDob(p.Dob)
            })
            .ToList();

        var duplicateParticipant = existingParticipants.Any(existing =>
            incoming.Any(i =>
                string.Equals(i.FullName, existing.FullName, StringComparison.OrdinalIgnoreCase)
                && i.Dob == existing.DateOfBirth));

        if (duplicateParticipant)
            return true;

        if (!ProgramTypeRules.IsTeamProgram(program.Type))
            return false;

        var teamName = NormalizeTeamName(group.Participants.FirstOrDefault()?.ClubSchoolCompany);
        return await FindDuplicateTeamNameAsync(program.ProgramId, teamName, ct);
    }

    private async Task<bool> FindDuplicateTeamNameAsync(int programId, string teamName, CancellationToken ct, int? excludingGroupId = null)
    {
        var normalizedTeamName = NormalizeTeamName(teamName);
        if (string.IsNullOrWhiteSpace(normalizedTeamName)) return false;

        var existingTeamNames = await _db.ParticipantGroups
            .Where(g =>
                g.ProgramId == programId &&
                g.GroupStatus != StatusCodesEx.Registration.Cancelled &&
                g.Registration.RegStatus != StatusCodesEx.Registration.Cancelled &&
                (!excludingGroupId.HasValue || g.GroupId != excludingGroupId.Value))
            .Select(g => g.ClubDisplay)
            .ToListAsync(ct);

        return existingTeamNames
            .Select(NormalizeTeamName)
            .Any(existing => string.Equals(existing, normalizedTeamName, StringComparison.OrdinalIgnoreCase));
    }

    private RegistrationWorkflowResult<object> ValidateParticipants(
        CreateGroupDto group,
        TrsProgram program,
        List<ExistingParticipantIdentity> existingParticipants)
    {
        if (group.Participants == null || group.Participants.Count < program.MinPlayers || group.Participants.Count > program.MaxPlayers)
            return RegistrationWorkflowResult<object>.Fail("INVALID_PARTICIPANT_COUNT", $"'{program.Name}' requires between {program.MinPlayers} and {program.MaxPlayers} participants.");

        var participantIdentities = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var participant in group.Participants)
        {
            if (string.IsNullOrWhiteSpace(participant.FullName))
                return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", "Participant full name is required.");
            if (string.IsNullOrWhiteSpace(participant.Dob) || ParseDob(participant.Dob) == null)
                return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", $"Date of birth is required for '{participant.FullName}'.");
            if (string.IsNullOrWhiteSpace(participant.Gender))
                return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", $"Gender is required for '{participant.FullName}'.");
            if (string.IsNullOrWhiteSpace(participant.Email))
                return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", $"Email is required for '{participant.FullName}'.");
            if (string.IsNullOrWhiteSpace(participant.ContactNumber))
                return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", $"Contact number is required for '{participant.FullName}'.");
            if (string.IsNullOrWhiteSpace(participant.Nationality))
                return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", $"Nationality is required for '{participant.FullName}'.");
            if (string.IsNullOrWhiteSpace(participant.ClubSchoolCompany))
                return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", $"Club / school / company is required for '{participant.FullName}'.");

            var dob = ParseDob(participant.Dob)!;
            var identity = $"{participant.FullName}|{dob:yyyy-MM-dd}";
            if (!participantIdentities.Add(identity))
                return RegistrationWorkflowResult<object>.Fail("DUPLICATE_REGISTRATION", $"Duplicate participant detected in '{program.Name}'.");

            var age = CalculateAge(dob.Value);
            if (age < program.MinAge || age > program.MaxAge)
                return RegistrationWorkflowResult<object>.Fail("INVALID_AGE", $"'{participant.FullName}' does not meet the age requirement for '{program.Name}'.");

            if (string.Equals(program.Gender, "Male", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(participant.Gender, "Male", StringComparison.OrdinalIgnoreCase))
                return RegistrationWorkflowResult<object>.Fail("INVALID_GENDER", $"'{program.Name}' is for male participants only.");

            if (string.Equals(program.Gender, "Female", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(participant.Gender, "Female", StringComparison.OrdinalIgnoreCase))
                return RegistrationWorkflowResult<object>.Fail("INVALID_GENDER", $"'{program.Name}' is for female participants only.");

            if (program.Fields?.EnableTshirt == true && program.Fields.RequireTshirt && string.IsNullOrWhiteSpace(participant.TshirtSize))
                return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", $"T-shirt size is required for '{participant.FullName}'.");

            if (program.Fields?.EnableGuardianInfo == true && program.Fields.RequireGuardianInfo)
            {
                if (string.IsNullOrWhiteSpace(participant.GuardianName) || string.IsNullOrWhiteSpace(participant.GuardianContact))
                    return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", $"Guardian details are required for '{participant.FullName}'.");
            }

            if (program.Fields?.EnableSbaId == true && program.Fields.RequireSbaId && string.IsNullOrWhiteSpace(participant.SbaId))
                return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", $"SBA ID is required for '{participant.FullName}'.");

            if (program.Fields?.EnableDocumentUpload == true && program.Fields.RequireDocumentUpload && string.IsNullOrWhiteSpace(participant.DocumentUrl))
                return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", $"Document upload is required for '{participant.FullName}'.");

            if (program.Fields?.EnableRemark == true && program.Fields.RequireRemark && string.IsNullOrWhiteSpace(participant.Remark))
                return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", $"Remark is required for '{participant.FullName}'.");

            foreach (var customField in program.CustomFields.Where(cf => cf.IsRequired))
            {
                if (!participant.CustomFieldValues.TryGetValue(customField.CustomFieldId.ToString(), out var value)
                    || string.IsNullOrWhiteSpace(value))
                    return RegistrationWorkflowResult<object>.Fail("MISSING_REQUIRED_FIELD", $"'{customField.Label}' is required for '{participant.FullName}'.");
            }

            if (existingParticipants.Any(existing =>
                existing.ProgramId == group.ProgramId
                && string.Equals(existing.FullName, participant.FullName, StringComparison.OrdinalIgnoreCase)
                && existing.DateOfBirth == dob))
            {
                return RegistrationWorkflowResult<object>.Fail("DUPLICATE_REGISTRATION", $"One or more participants are already registered for '{program.Name}'.");
            }
        }

        if (string.Equals(program.Gender, "Mixed", StringComparison.OrdinalIgnoreCase))
        {
            var maleCount = group.Participants.Count(p => string.Equals(p.Gender, "Male", StringComparison.OrdinalIgnoreCase));
            var femaleCount = group.Participants.Count(p => string.Equals(p.Gender, "Female", StringComparison.OrdinalIgnoreCase));
            if (maleCount != 1 || femaleCount != 1)
                return RegistrationWorkflowResult<object>.Fail("INVALID_GENDER", $"'{program.Name}' requires exactly one male and one female participant.");
        }

        return RegistrationWorkflowResult<object>.Ok(null);
    }

    private static void NormalizeGroupClubValues(CreateGroupDto group, TrsProgram program)
    {
        if (group.Participants == null || group.Participants.Count == 0)
            return;

        if (ProgramTypeRules.IsTeamProgram(program.Type))
        {
            var teamName = NormalizeTeamName(group.Participants[0].ClubSchoolCompany);
            foreach (var participant in group.Participants)
                participant.ClubSchoolCompany = teamName;
            return;
        }

        foreach (var participant in group.Participants)
            participant.ClubSchoolCompany = participant.ClubSchoolCompany?.Trim();
    }

    private static string NormalizeTeamName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        return string.Join(" ", value.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }

    private static ProgramCustomField? ResolveCustomField(IEnumerable<ProgramCustomField> customFields, string key)
    {
        return int.TryParse(key, out var customFieldId)
            ? customFields.FirstOrDefault(cf => cf.CustomFieldId == customFieldId)
            : null;
    }

    public static string ComputeRegistrationStatus(Event eventEntity, int activeProgramCount)
    {
        if (!eventEntity.IsActive)
            return StatusCodesEx.EventRegistration.Closed;
        if (activeProgramCount <= 0)
            return StatusCodesEx.EventRegistration.Draft;

        if (eventEntity.RegistrationStatus == StatusCodesEx.EventRegistration.Paused)
            return StatusCodesEx.EventRegistration.Paused;
        if (eventEntity.RegistrationStatus == StatusCodesEx.EventRegistration.Closed)
            return StatusCodesEx.EventRegistration.Closed;

        var today = TodayInSingapore();
        if (today < eventEntity.OpenDate)
            return StatusCodesEx.EventRegistration.Upcoming;
        if (today > eventEntity.CloseDate)
            return StatusCodesEx.EventRegistration.Closed;

        return StatusCodesEx.EventRegistration.Open;
    }

    private static (string Code, string Message)? ValidateEventGate(
        EventRegistrationGateMode gateMode,
        string registrationStatus)
    {
        if (gateMode == EventRegistrationGateMode.AlreadyPaidFinalization)
            return null;

        if (registrationStatus == StatusCodesEx.EventRegistration.Draft)
            return ("EVENT_DRAFT", "Add at least one program before accepting registrations.");

        if (gateMode == EventRegistrationGateMode.AdminAssisted)
            return null;

        return registrationStatus == StatusCodesEx.EventRegistration.Open
            ? null
            : ("EVENT_CLOSED", "This event is not accepting registrations.");
    }

    private static DateOnly? ParseDob(string? dob)
    {
        if (string.IsNullOrWhiteSpace(dob))
            return null;

        return DateOnly.TryParse(dob, out var parsed) ? parsed : null;
    }

    private static int CalculateAge(DateOnly dob)
    {
        var today = TodayInSingapore();
        var age = today.Year - dob.Year;
        if (dob > today.AddYears(-age))
            age--;
        return age;
    }

    private static DateOnly TodayInSingapore()
    {
        var utcNow = DateTimeOffset.UtcNow;
        var timeZone = ResolveSingaporeTimeZone();
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(utcNow, timeZone).DateTime);
    }

    private static TimeZoneInfo ResolveSingaporeTimeZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Singapore Standard Time");
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Asia/Singapore");
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Asia/Singapore");
        }
    }

    private static decimal ResolveSnapshotPerPlayerAmount(CreateGroupDto group)
    {
        if (group.Participants.Count == 0)
            return 0m;
        return decimal.Round(group.Fee / group.Participants.Count, 2);
    }

    private async Task<Dictionary<int, int>> GetActiveProgramSlotCountsAsync(
        IEnumerable<TrsProgram> programs,
        CancellationToken ct)
    {
        var programList = programs.ToList();
        if (programList.Count == 0) return new();

        var programIds = programList.Select(p => p.ProgramId).ToList();
        var activeGroups = _db.ParticipantGroups
            .Where(g =>
                programIds.Contains(g.ProgramId) &&
                g.GroupStatus != StatusCodesEx.Registration.Cancelled &&
                g.Registration.RegStatus != StatusCodesEx.Registration.Cancelled);

        var groupCounts = await activeGroups
            .GroupBy(g => g.ProgramId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);

        var participantCounts = await activeGroups
            .SelectMany(g => g.Participants
                .Where(p => p.ParticipantStatus != StatusCodesEx.Participant.Cancelled)
                .Select(p => new { g.ProgramId }))
            .GroupBy(x => x.ProgramId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);

        return programList.ToDictionary(
            p => p.ProgramId,
            p => IsPerPlayer(p.FeeStructure)
                ? participantCounts.GetValueOrDefault(p.ProgramId)
                : groupCounts.GetValueOrDefault(p.ProgramId));
    }

    private Task<int> CountActiveProgramSlotsAsync(TrsProgram program, CancellationToken ct)
    {
        var activeGroups = _db.ParticipantGroups
            .Where(g =>
                g.ProgramId == program.ProgramId &&
                g.GroupStatus != StatusCodesEx.Registration.Cancelled &&
                g.Registration.RegStatus != StatusCodesEx.Registration.Cancelled);

        if (!IsPerPlayer(program.FeeStructure))
            return activeGroups.CountAsync(ct);

        return activeGroups
            .SelectMany(g => g.Participants)
            .CountAsync(p => p.ParticipantStatus != StatusCodesEx.Participant.Cancelled, ct);
    }

    private static bool IsPerPlayer(string? feeStructure) =>
        string.Equals(feeStructure, "per_player", StringComparison.OrdinalIgnoreCase);

    private static bool IsAdminConfirmedPaymentStatus(string? paymentStatus) =>
        paymentStatus == StatusCodesEx.Payment.Success ||
        paymentStatus == StatusCodesEx.Payment.Waived ||
        paymentStatus == StatusCodesEx.Payment.PendingCollection;

    private static bool IsManualAdminPaymentGateway(string? paymentGateway) =>
        string.Equals(paymentGateway, "Manual", StringComparison.OrdinalIgnoreCase);

    private async Task QueueReceiptEmailAsync(int registrationId, int paymentId)
    {
        await _jobQueue.EnqueueAsync(async ct =>
        {
            using var scope = _serviceScopeFactory.CreateScope();
            var receiptSvc = scope.ServiceProvider.GetRequiredService<ReceiptService>();
            var detailsPdfSvc = scope.ServiceProvider.GetRequiredService<RegistrationDetailsPdfService>();
            var emailSvc = scope.ServiceProvider.GetRequiredService<EmailService>();
            var jobDb = scope.ServiceProvider.GetRequiredService<TRSDbContext>();

            try
            {
                var pdfBytes = await receiptSvc.GenerateAsync(jobDb, registrationId);
                var detailsPdfBytes = await detailsPdfSvc.GenerateAsync(jobDb, registrationId);
                await emailSvc.SendPaymentConfirmationAsync(jobDb, registrationId, pdfBytes, detailsPdfBytes, ct);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Failed to generate receipt for payment {PaymentId}", paymentId);
            }
        });
    }

    private static async Task<RegistrationWorkflowResult<RegistrationCreateOutcome>> RollbackAndFail(
        IDbContextTransaction tx,
        string code,
        string message)
    {
        await tx.RollbackAsync();
        return RegistrationWorkflowResult<RegistrationCreateOutcome>.Fail(code, message);
    }

    private sealed class ExistingParticipantIdentity
    {
        public int ProgramId { get; init; }
        public string FullName { get; init; } = "";
        public DateOnly? DateOfBirth { get; init; }
    }

    private sealed class PendingPaymentItem
    {
        public int GroupId { get; init; }
        public int EventId { get; init; }
        public int ProgramId { get; init; }
        public string ProgramName { get; init; } = "";
        public string Description { get; init; } = "";
        public string? PlayerName { get; init; }
        public decimal Amount { get; init; }
        public int? ParticipantId { get; init; }
    }
}

public sealed class RegistrationValidationOptions
{
    public EventRegistrationGateMode RegistrationGateMode { get; init; } = EventRegistrationGateMode.StrictPublic;
    public bool ValidatePricingAgainstCurrentPrograms { get; init; } = true;
}

public sealed class RegistrationPersistOptions
{
    public EventRegistrationGateMode RegistrationGateMode { get; init; } = EventRegistrationGateMode.StrictPublic;
    public bool ValidatePricingAgainstCurrentPrograms { get; init; } = true;
    public string PaymentGateway { get; init; } = "Stripe";
    public string? PaymentMethod { get; init; } = "CreditCard";
    public string PaymentStatus { get; init; } = StatusCodesEx.Payment.Pending;
    public decimal? PaymentAmountOverride { get; init; }
    public string? AdminNote { get; init; }
    public string? PaymentReference { get; init; }
    public string? ReceiptNumber { get; init; }
    public bool SuppressReceiptEmail { get; init; }
    public string? GatewaySessionId { get; init; }
    public string? GatewayPaymentId { get; init; }
}

public enum EventRegistrationGateMode
{
    StrictPublic,
    AdminAssisted,
    AlreadyPaidFinalization,
}

public sealed class PricingQuote
{
    public int EventId { get; init; }
    public string EventName { get; init; } = "";
    public string Currency { get; init; } = "SGD";
    public decimal TotalAmount { get; init; }
    public List<PricingQuoteGroup> Groups { get; init; } = new();
}

public sealed class PricingQuoteGroup
{
    public int ProgramId { get; init; }
    public string ProgramName { get; init; } = "";
    public decimal ExpectedFee { get; init; }
    public bool PaymentRequired { get; init; }
    public string FeeStructure { get; init; } = "per_entry";
    public int ParticipantCount { get; init; }
}

public sealed class RegistrationCreateOutcome
{
    public int RegistrationId { get; init; }
    public int PaymentId { get; init; }
    public decimal TotalAmount { get; init; }
    public string PaymentStatus { get; init; } = StatusCodesEx.Payment.Pending;
}

public sealed class RegistrationWorkflowResult<T>
{
    public bool Success { get; private init; }
    public string? Code { get; private init; }
    public string Message { get; private init; } = "";
    public T? Value { get; private init; }

    public static RegistrationWorkflowResult<T> Ok(T? value) => new()
    {
        Success = true,
        Value = value,
    };

    public static RegistrationWorkflowResult<T> Fail(string code, string message) => new()
    {
        Success = false,
        Code = code,
        Message = message,
    };
}
