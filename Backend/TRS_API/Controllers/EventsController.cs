using Ganss.Xss;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TRS_API.Models;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS_API.Controllers;

[ApiController, Route("api/events")]
public class EventsController : ControllerBase
{
    private readonly TRSDbContext _db;
    private readonly AdminAuditService _audit;
    // HtmlSanitizer (Ganss.Xss NuGet) strips dangerous tags from admin-authored HTML.
    // Install: dotnet add package HtmlSanitizer
    private static readonly HtmlSanitizer _sanitizer = new();

    public EventsController(TRSDbContext db, AdminAuditService audit) => (_db, _audit) = (db, audit);

    // ── Event CRUD ────────────────────────────────────────────────────────────

    // GET /api/events
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] bool includeInactive = false)
    {
        if (includeInactive && !User.IsInRole("superadmin") && !User.IsInRole("eventadmin"))
            includeInactive = false;

        var q = LoadEvents();
        if (!includeInactive) q = q.Where(e => e.IsActive && e.Programs.Any(p => p.IsActive));
        var events = await q.OrderByDescending(e => e.EventStartDate).ToListAsync();
        var counts = await GetParticipantCounts(events.SelectMany(e => e.Programs.Select(p => p.ProgramId)).ToList());
        return Ok(events.Select(e => MapEvent(e, counts)));
    }

    // GET /api/events/:id
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var isAdmin = User.IsInRole("superadmin") || User.IsInRole("eventadmin");
        var q = LoadEvents().Where(e => e.EventId == id);
        if (!isAdmin) q = q.Where(e => e.IsActive && e.Programs.Any(p => p.IsActive));
        var ev = await q.FirstOrDefaultAsync();
        if (ev == null) return NotFound(new { code = "NOT_FOUND", message = "Event not found." });
        var counts = await GetParticipantCounts(ev.Programs.Select(p => p.ProgramId).ToList());
        return Ok(MapEvent(ev, counts));
    }

    // POST /api/events
    [HttpPost, Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> Create([FromBody] UpsertEventRequest req)
    {
        var ev = ApplyEventFields(new Event { CreatedAt = DateTime.UtcNow, IsActive = true }, req);
        _db.Events.Add(ev);
        await _db.SaveChangesAsync();
        await _audit.LogAsync(
            User,
            GetClientIp(),
            "EVENT_CREATE",
            "Event",
            ev.EventId.ToString(),
            null,
            AuditEventSnapshot(ev),
            $"Created event '{ev.Name}'.");
        return await GetById(ev.EventId);
    }

    // PUT /api/events/:id
    [HttpPut("{id:int}"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpsertEventRequest req)
    {
        var ev = await _db.Events
            .Include(e => e.GalleryImages)
            .FirstOrDefaultAsync(e => e.EventId == id);
        if (ev == null) return NotFound(new { code = "NOT_FOUND", message = "Event not found." });
        var oldValue = AuditEventSnapshot(ev);
        ev.GalleryImages.Clear();
        ApplyEventFields(ev, req);
        ev.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await _audit.LogAsync(
            User,
            GetClientIp(),
            "EVENT_UPDATE",
            "Event",
            ev.EventId.ToString(),
            oldValue,
            AuditEventSnapshot(ev),
            $"Updated event '{ev.Name}'.");
        return await GetById(id);
    }

    // DELETE /api/events/:id
    [HttpDelete("{id:int}"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> Delete(int id)
    {
        var ev = await _db.Events.FindAsync(id);
        if (ev == null) return NotFound(new { code = "NOT_FOUND", message = "Event not found." });
        var registrationCount = await _db.EventRegistrations.CountAsync(r => r.EventId == id);
        if (registrationCount > 0)
        {
            return Conflict(new
            {
                code = "EVENT_HAS_REGISTRATIONS",
                message = $"This event cannot be deleted because it has {registrationCount} registration record(s)."
            });
        }

        var oldValue = AuditEventSnapshot(ev);
        ev.IsActive = false;
        ev.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await _audit.LogAsync(
            User,
            GetClientIp(),
            "EVENT_DELETE",
            "Event",
            ev.EventId.ToString(),
            oldValue,
            AuditEventSnapshot(ev),
            $"Deleted event '{ev.Name}'.");
        return Ok();
    }

    [HttpPatch("{id:int}/registration-status"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> UpdateRegistrationStatus(int id, [FromBody] UpdateEventRegistrationStatusRequest req)
    {
        var status = (req.Status ?? "").Trim().ToLowerInvariant();
        if (status is not ("open" or "paused" or "closed"))
            return BadRequest(new { code = "INVALID_STATUS", message = "Status must be open, paused, or closed." });

        var ev = await _db.Events
            .Include(e => e.GalleryImages)
            .FirstOrDefaultAsync(e => e.EventId == id);
        if (ev == null) return NotFound(new { code = "NOT_FOUND", message = "Event not found." });

        var activeProgramCount = await _db.Programs.CountAsync(p => p.EventId == id && p.IsActive);
        if (activeProgramCount == 0)
            return BadRequest(new { code = "EVENT_DRAFT", message = "Add at least one program before changing registration status." });

        var oldValue = AuditEventSnapshot(ev);
        ev.RegistrationStatus = status;
        ev.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await _audit.LogAsync(
            User,
            GetClientIp(),
            "EVENT_REGISTRATION_STATUS_UPDATE",
            "Event",
            ev.EventId.ToString(),
            oldValue,
            AuditEventSnapshot(ev),
            $"Changed event '{ev.Name}' registration status to {ev.RegistrationStatus}.");

        var loaded = await LoadEvents().FirstAsync(e => e.EventId == id);
        var counts = await GetParticipantCounts(loaded.Programs.Select(p => p.ProgramId).ToList());
        return Ok(MapEvent(loaded, counts));
    }

    // ── Document sub-resource ─────────────────────────────────────────────────

    // GET /api/events/:id/documents
    [HttpGet("{id:int}/documents")]
    public async Task<IActionResult> GetDocuments(int id)
    {
        if (!await _db.Events.AnyAsync(e => e.EventId == id && e.IsActive))
            return NotFound(new { code = "NOT_FOUND", message = "Event not found." });

        var docs = await _db.EventDocuments
            .Where(d => d.EventId == id)
            .OrderBy(d => d.DisplayOrder)
            .Select(d => new EventDocumentDto
            {
                Id = d.EventDocumentId, Label = d.Label,
                FileUrl = d.FileUrl, DisplayOrder = d.DisplayOrder
            })
            .ToListAsync();

        return Ok(docs);
    }

    // POST /api/events/:id/documents
    [HttpPost("{id:int}/documents"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> AddDocument(int id, [FromBody] UpsertEventDocumentRequest req)
    {
        if (!await _db.Events.AnyAsync(e => e.EventId == id))
            return NotFound(new { code = "NOT_FOUND", message = "Event not found." });

        if (string.IsNullOrWhiteSpace(req.Label))
            return BadRequest(new { code = "LABEL_REQUIRED", message = "Label is required." });
        if (string.IsNullOrWhiteSpace(req.FileUrl))
            return BadRequest(new { code = "FILEURL_REQUIRED", message = "FileUrl is required." });

        var doc = new EventDocument
        {
            EventId      = id,
            Label        = req.Label.Trim(),
            FileUrl      = req.FileUrl.Trim(),
            DisplayOrder = req.DisplayOrder,
            CreatedAt    = DateTime.UtcNow,
        };
        _db.EventDocuments.Add(doc);
        await _db.SaveChangesAsync();

        return Ok(new EventDocumentDto
        {
            Id = doc.EventDocumentId, Label = doc.Label,
            FileUrl = doc.FileUrl, DisplayOrder = doc.DisplayOrder
        });
    }

    // PUT /api/events/:id/documents/:did
    [HttpPut("{id:int}/documents/{did:int}"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> UpdateDocument(int id, int did, [FromBody] UpsertEventDocumentRequest req)
    {
        var doc = await _db.EventDocuments.FirstOrDefaultAsync(d => d.EventDocumentId == did && d.EventId == id);
        if (doc == null) return NotFound(new { code = "NOT_FOUND", message = "Document not found." });

        doc.Label        = req.Label.Trim();
        doc.FileUrl      = req.FileUrl.Trim();
        doc.DisplayOrder = req.DisplayOrder;
        await _db.SaveChangesAsync();

        return Ok(new EventDocumentDto
        {
            Id = doc.EventDocumentId, Label = doc.Label,
            FileUrl = doc.FileUrl, DisplayOrder = doc.DisplayOrder
        });
    }

    // DELETE /api/events/:id/documents/:did
    [HttpDelete("{id:int}/documents/{did:int}"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> DeleteDocument(int id, int did)
    {
        var doc = await _db.EventDocuments.FirstOrDefaultAsync(d => d.EventDocumentId == did && d.EventId == id);
        if (doc == null) return NotFound(new { code = "NOT_FOUND", message = "Document not found." });
        _db.EventDocuments.Remove(doc);
        await _db.SaveChangesAsync();
        return Ok();
    }

    // ── Program sub-resource (unchanged from original) ────────────────────────

    [HttpPost("{id:int}/programs"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> AddProgram(int id, [FromBody] UpsertProgramRequest req)
    {
        if (!await _db.Events.AnyAsync(e => e.EventId == id))
            return NotFound(new { code = "NOT_FOUND", message = "Event not found." });
        var prog = ApplyProgramFields(new TrsProgram { EventId = id, CreatedAt = DateTime.UtcNow, IsActive = true }, req);
        _db.Programs.Add(prog);
        await _db.SaveChangesAsync();
        await _audit.LogAsync(
            User,
            GetClientIp(),
            "PROGRAM_CREATE",
            "Program",
            prog.ProgramId.ToString(),
            null,
            AuditProgramSnapshot(prog),
            $"Created program '{prog.Name}' for event {id}.");
        return Ok(MapProgram(prog, 0));
    }

    [HttpPut("{eid:int}/programs/{pid:int}"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> UpdateProgram(int eid, int pid, [FromBody] UpsertProgramRequest req)
    {
        var prog = await _db.Programs.Include(p => p.Fields).Include(p => p.CustomFields)
            .FirstOrDefaultAsync(p => p.ProgramId == pid && p.EventId == eid);
        if (prog == null) return NotFound(new { code = "NOT_FOUND", message = "Program not found." });
        if (prog.TeamMode != req.TeamMode)
        {
            var fixtureExists = await _db.Fixtures.AnyAsync(f => f.ProgramId == pid);
            if (fixtureExists)
            {
                return Conflict(new
                {
                    code = "PROGRAM_FIXTURE_EXISTS",
                    message = "Team mode cannot be changed after fixtures have been generated. Reset the fixture first."
                });
            }
        }

        var activeGroupCount = await CountActiveParticipantGroups(pid);
        if (activeGroupCount > 0)
        {
            var validationMessage = ValidateProgramUpdateWithRegistrations(prog, req, activeGroupCount);
            if (validationMessage != null)
            {
                return Conflict(new
                {
                    code = "PROGRAM_HAS_REGISTRATIONS",
                    message = validationMessage
                });
            }
        }

        var oldValue = AuditProgramSnapshot(prog);
        if (activeGroupCount > 0)
        {
            ApplyRegisteredProgramSafeFields(prog, req);
        }
        else
        {
            prog.CustomFields.Clear();
            ApplyProgramFields(prog, req);
        }

        prog.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await _audit.LogAsync(
            User,
            GetClientIp(),
            "PROGRAM_UPDATE",
            "Program",
            prog.ProgramId.ToString(),
            oldValue,
            AuditProgramSnapshot(prog),
            $"Updated program '{prog.Name}' for event {eid}.");
        return Ok(MapProgram(prog, 0));
    }

    [HttpPatch("{eid:int}/programs/{pid:int}/status"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> UpdateProgramStatus(int eid, int pid, [FromBody] UpdateProgramStatusRequest req)
    {
        var prog = await _db.Programs.Include(p => p.Fields).Include(p => p.CustomFields)
            .FirstOrDefaultAsync(p => p.ProgramId == pid && p.EventId == eid);
        if (prog == null) return NotFound(new { code = "NOT_FOUND", message = "Program not found." });
        if (req.Status != "open" && req.Status != "closed")
            return BadRequest(new { code = "INVALID_STATUS", message = "Status must be 'open' or 'closed'." });
        var oldValue = AuditProgramSnapshot(prog);
        prog.Status    = req.Status;
        prog.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await _audit.LogAsync(
            User,
            GetClientIp(),
            "PROGRAM_STATUS_UPDATE",
            "Program",
            prog.ProgramId.ToString(),
            oldValue,
            AuditProgramSnapshot(prog),
            $"Changed program '{prog.Name}' status to {prog.Status} for event {eid}.");
        return Ok(new { programId = pid, status = prog.Status });
    }

    [HttpDelete("{eid:int}/programs/{pid:int}"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> DeleteProgram(int eid, int pid)
    {
        var prog = await _db.Programs.Include(p => p.Fields).Include(p => p.CustomFields)
            .FirstOrDefaultAsync(p => p.ProgramId == pid && p.EventId == eid);
        if (prog == null) return NotFound(new { code = "NOT_FOUND", message = "Program not found." });
        var activeGroupCount = await CountActiveParticipantGroups(pid);
        if (activeGroupCount > 0)
        {
            return Conflict(new
            {
                code = "PROGRAM_HAS_REGISTRATIONS",
                message = $"This program cannot be removed because it has {activeGroupCount} non-cancelled registered participant group(s). Close the program instead to stop new registrations."
            });
        }

        var oldValue = AuditProgramSnapshot(prog);
        prog.IsActive  = false;
        prog.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await _audit.LogAsync(
            User,
            GetClientIp(),
            "PROGRAM_DELETE",
            "Program",
            prog.ProgramId.ToString(),
            oldValue,
            AuditProgramSnapshot(prog),
            $"Deleted program '{prog.Name}' from event {eid}.");
        return Ok();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private IQueryable<Event> LoadEvents() =>
        _db.Events
            .Include(e => e.Programs.Where(p => p.IsActive)).ThenInclude(p => p.Fields)
            .Include(e => e.Programs.Where(p => p.IsActive)).ThenInclude(p => p.CustomFields)
            .Include(e => e.GalleryImages)
            .Include(e => e.Documents.OrderBy(d => d.DisplayOrder));   // NEW

    private async Task<Dictionary<int, int>> GetParticipantCounts(List<int> programIds)
    {
        if (!programIds.Any()) return new();
        return await _db.ParticipantGroups
            .Where(g => programIds.Contains(g.ProgramId) && g.GroupStatus != "Cancelled")
            .GroupBy(g => g.ProgramId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count);
    }

    private Task<int> CountActiveParticipantGroups(int programId) =>
        _db.ParticipantGroups.CountAsync(g => g.ProgramId == programId && g.GroupStatus != "Cancelled");

    private static Event ApplyEventFields(Event ev, UpsertEventRequest r)
    {
        ev.Name             = r.Name;
        ev.Description      = r.Description;
        ev.Venue            = r.Venue;
        ev.VenueAddress     = r.VenueAddress;
        ev.BannerUrl        = r.BannerUrl;
        // Sanitise HTML before persisting — strips scripts/iframes etc.
        ev.AdditionalInfo   = string.IsNullOrWhiteSpace(r.AdditionalInfo)
                                ? null
                                : _sanitizer.Sanitize(r.AdditionalInfo);
        ev.EventStartDate   = DateOnly.Parse(r.EventStartDate);
        ev.EventEndDate     = r.EventEndDate != null ? DateOnly.Parse(r.EventEndDate) : null;
        ev.OpenDate         = DateOnly.Parse(r.OpenDate);
        ev.CloseDate        = DateOnly.Parse(r.CloseDate);
        ev.MaxParticipants  = r.MaxParticipants;
        ev.SponsorInfo      = r.SponsorInfo;
        ev.ConsentStatement = r.ConsentStatement;
        ev.IsSports         = r.IsSports;
        ev.SportType        = r.SportType;
        ev.FixtureMode      = r.FixtureMode;
        if (string.IsNullOrWhiteSpace(ev.RegistrationStatus))
            ev.RegistrationStatus = "open";
        ev.GalleryImages    = r.GalleryUrls.Select((url, i) =>
            new EventGalleryImage { ImageUrl = url, SortOrder = i }).ToList();
        return ev;
    }

    private static TrsProgram ApplyProgramFields(TrsProgram p, UpsertProgramRequest r)
    {
        p.Name = r.Name; p.Type = r.Type; p.MinAge = r.MinAge; p.MaxAge = r.MaxAge;
        p.SbaRankingType = string.IsNullOrWhiteSpace(r.SbaRankingType) ? null : r.SbaRankingType.Trim();
        p.Gender = r.Gender; p.Fee = r.Fee; p.PaymentRequired = r.PaymentRequired;
        p.FeeStructure = r.FeeStructure;
        p.TeamMode = r.TeamMode;
        p.MinPlayers = r.MinPlayers; p.MaxPlayers = r.MaxPlayers;
        p.MinParticipants = r.MinParticipants; p.MaxParticipants = r.MaxParticipants;
        if (p.Fields != null)
        {
            p.Fields.EnableSbaId = r.Fields.EnableSbaId; p.Fields.EnableDocumentUpload = r.Fields.EnableDocumentUpload;
            p.Fields.EnableGuardianInfo = r.Fields.EnableGuardianInfo; p.Fields.EnableRemark = r.Fields.EnableRemark;
            p.Fields.EnableTshirt = r.Fields.EnableTshirt;
            p.Fields.RequireSbaId = r.Fields.RequireSbaId && r.Fields.EnableSbaId;
            p.Fields.RequireDocumentUpload = r.Fields.RequireDocumentUpload && r.Fields.EnableDocumentUpload;
            p.Fields.RequireGuardianInfo = r.Fields.RequireGuardianInfo && r.Fields.EnableGuardianInfo;
            p.Fields.RequireRemark = r.Fields.RequireRemark && r.Fields.EnableRemark;
            p.Fields.RequireTshirt = r.Fields.RequireTshirt && r.Fields.EnableTshirt;
        }
        else
        {
            p.Fields = new ProgramField
            {
                EnableSbaId = r.Fields.EnableSbaId, EnableDocumentUpload = r.Fields.EnableDocumentUpload,
                EnableGuardianInfo = r.Fields.EnableGuardianInfo, EnableRemark = r.Fields.EnableRemark,
                EnableTshirt = r.Fields.EnableTshirt,
                RequireSbaId = r.Fields.RequireSbaId && r.Fields.EnableSbaId,
                RequireDocumentUpload = r.Fields.RequireDocumentUpload && r.Fields.EnableDocumentUpload,
                RequireGuardianInfo = r.Fields.RequireGuardianInfo && r.Fields.EnableGuardianInfo,
                RequireRemark = r.Fields.RequireRemark && r.Fields.EnableRemark,
                RequireTshirt = r.Fields.RequireTshirt && r.Fields.EnableTshirt
            };
        }
        p.CustomFields = r.Fields.CustomFields.Select((cf, i) => new ProgramCustomField
        {
            Label = cf.Label, FieldType = cf.FieldType, IsRequired = cf.IsRequired,
            Options = cf.Options, SortOrder = i
        }).ToList();
        return p;
    }

    private static void ApplyRegisteredProgramSafeFields(TrsProgram p, UpsertProgramRequest r)
    {
        p.Name = r.Name;
        p.TeamMode = r.TeamMode;
        p.MinParticipants = r.MinParticipants;
        p.MaxParticipants = r.MaxParticipants;
    }

    private static string? ValidateProgramUpdateWithRegistrations(
        TrsProgram current,
        UpsertProgramRequest requested,
        int activeGroupCount)
    {
        if (!string.Equals(current.Type, requested.Type, StringComparison.Ordinal))
            return RegisteredProgramChangeBlockedMessage("program format/type");
        if (!string.Equals(NormalizeNullable(current.SbaRankingType), NormalizeNullable(requested.SbaRankingType), StringComparison.Ordinal))
            return RegisteredProgramChangeBlockedMessage("SBA ranking type");
        if (current.MinAge != requested.MinAge || current.MaxAge != requested.MaxAge)
            return RegisteredProgramChangeBlockedMessage("age limits");
        if (!string.Equals(current.Gender, requested.Gender, StringComparison.Ordinal))
            return RegisteredProgramChangeBlockedMessage("gender rule");
        if (current.Fee != requested.Fee || current.PaymentRequired != requested.PaymentRequired ||
            !string.Equals(current.FeeStructure, requested.FeeStructure, StringComparison.Ordinal))
            return RegisteredProgramChangeBlockedMessage("payment or fee settings");
        if (current.MinPlayers != requested.MinPlayers || current.MaxPlayers != requested.MaxPlayers)
            return RegisteredProgramChangeBlockedMessage("players-per-entry limits");
        if (requested.MinParticipants > activeGroupCount)
            return $"This program already has {activeGroupCount} non-cancelled registered participant group(s). Minimum entries cannot be raised above the current registration count.";
        if (requested.MaxParticipants < activeGroupCount)
            return $"This program already has {activeGroupCount} non-cancelled registered participant group(s). Capacity cannot be reduced below the current registration count.";
        if (!ProgramFieldsMatch(current.Fields, requested.Fields) || !CustomFieldsMatch(current.CustomFields, requested.Fields.CustomFields))
            return RegisteredProgramChangeBlockedMessage("participant field settings");

        return null;
    }

    private static string RegisteredProgramChangeBlockedMessage(string fieldGroup) =>
        $"This program already has registered participants. Changing {fieldGroup} could conflict with existing registrations.";

    private static string? NormalizeNullable(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static bool ProgramFieldsMatch(ProgramField? current, ProgramFieldsDto requested)
    {
        if (current == null)
        {
            return !requested.EnableSbaId &&
                   !requested.EnableDocumentUpload &&
                   !requested.EnableGuardianInfo &&
                   !requested.EnableRemark &&
                   !requested.EnableTshirt &&
                   !requested.RequireSbaId &&
                   !requested.RequireDocumentUpload &&
                   !requested.RequireGuardianInfo &&
                   !requested.RequireRemark &&
                   !requested.RequireTshirt;
        }

        return current.EnableSbaId == requested.EnableSbaId &&
               current.EnableDocumentUpload == requested.EnableDocumentUpload &&
               current.EnableGuardianInfo == requested.EnableGuardianInfo &&
               current.EnableRemark == requested.EnableRemark &&
               current.EnableTshirt == requested.EnableTshirt &&
               current.RequireSbaId == (requested.RequireSbaId && requested.EnableSbaId) &&
               current.RequireDocumentUpload == (requested.RequireDocumentUpload && requested.EnableDocumentUpload) &&
               current.RequireGuardianInfo == (requested.RequireGuardianInfo && requested.EnableGuardianInfo) &&
               current.RequireRemark == (requested.RequireRemark && requested.EnableRemark) &&
               current.RequireTshirt == (requested.RequireTshirt && requested.EnableTshirt);
    }

    private static bool CustomFieldsMatch(ICollection<ProgramCustomField> current, List<CustomFieldDto> requested)
    {
        var currentFields = current
            .OrderBy(cf => cf.SortOrder)
            .Select(cf => new
            {
                Label = cf.Label.Trim(),
                Type = cf.FieldType.Trim(),
                cf.IsRequired,
                Options = NormalizeNullable(cf.Options),
                cf.SortOrder,
            })
            .ToList();

        var requestedFields = requested
            .OrderBy(cf => cf.SortOrder)
            .Select(cf => new
            {
                Label = cf.Label.Trim(),
                Type = cf.FieldType.Trim(),
                cf.IsRequired,
                Options = NormalizeNullable(cf.Options),
                cf.SortOrder,
            })
            .ToList();

        if (currentFields.Count != requestedFields.Count)
            return false;

        for (var i = 0; i < currentFields.Count; i++)
        {
            if (currentFields[i].Label != requestedFields[i].Label ||
                currentFields[i].Type != requestedFields[i].Type ||
                currentFields[i].IsRequired != requestedFields[i].IsRequired ||
                currentFields[i].Options != requestedFields[i].Options ||
                currentFields[i].SortOrder != requestedFields[i].SortOrder)
            {
                return false;
            }
        }

        return true;
    }

    private static object MapProgram(TrsProgram p, int currentParticipants) => new
    {
        id = p.ProgramId.ToString(), p.Name, p.Type, p.SbaRankingType,
        p.MinAge, p.MaxAge, p.Gender, p.Fee, p.PaymentRequired, p.FeeStructure,
        p.TeamMode,
        p.MinPlayers, p.MaxPlayers, p.MinParticipants, p.MaxParticipants,
        currentParticipants, p.Status, participantSeeds = new List<object>(),
        fields = p.Fields == null
            ? (object)new { enableSbaId = false, enableDocumentUpload = false, enableGuardianInfo = false, enableRemark = false, enableTshirt = false, requireSbaId = false, requireDocumentUpload = false, requireGuardianInfo = false, requireRemark = false, requireTshirt = false, customFields = new List<object>() }
            : new
            {
                enableSbaId = p.Fields.EnableSbaId, enableDocumentUpload = p.Fields.EnableDocumentUpload,
                enableGuardianInfo = p.Fields.EnableGuardianInfo, enableRemark = p.Fields.EnableRemark,
                enableTshirt = p.Fields.EnableTshirt,
                requireSbaId = p.Fields.RequireSbaId, requireDocumentUpload = p.Fields.RequireDocumentUpload,
                requireGuardianInfo = p.Fields.RequireGuardianInfo, requireRemark = p.Fields.RequireRemark,
                requireTshirt = p.Fields.RequireTshirt,
                customFields = p.CustomFields.OrderBy(cf => cf.SortOrder).Select(cf => (object)new
                {
                    id = cf.CustomFieldId,
                    customFieldId = cf.CustomFieldId,
                    label = cf.Label,
                    type = cf.FieldType,
                    required = cf.IsRequired,
                    options = cf.Options
                }).ToList()
            }
    };

    private static object MapEvent(Event ev, Dictionary<int, int> counts) => new
    {
        id              = ev.EventId.ToString(),
        ev.Name,
        ev.Description,
        ev.Venue,
        ev.VenueAddress,
        bannerUrl       = ev.BannerUrl ?? "",
        additionalInfo  = ev.AdditionalInfo ?? "",          // NEW — replaces prospectusUrl
        galleryUrls     = ev.GalleryImages.OrderBy(g => g.SortOrder).Select(g => g.ImageUrl).ToList(),
        documents       = ev.Documents.OrderBy(d => d.DisplayOrder).Select(d => new   // NEW
        {
            id           = d.EventDocumentId,
            label        = d.Label,
            fileUrl      = d.FileUrl,
            displayOrder = d.DisplayOrder,
        }).ToList(),
        eventStartDate  = ev.EventStartDate.ToString("yyyy-MM-dd"),
        eventEndDate    = ev.EventEndDate?.ToString("yyyy-MM-dd") ?? "",
        openDate        = ev.OpenDate.ToString("yyyy-MM-dd"),
        closeDate       = ev.CloseDate.ToString("yyyy-MM-dd"),
        ev.MaxParticipants,
        sponsorInfo     = ev.SponsorInfo ?? "",
        consentStatement = ev.ConsentStatement ?? "",
        ev.IsSports,
        sportType       = ev.SportType ?? "",
        ev.FixtureMode,
        registrationStatus = ev.RegistrationStatus,
        computedRegistrationStatus = RegistrationWorkflowService.ComputeRegistrationStatus(ev, ev.Programs.Count(p => p.IsActive)),
        programs        = ev.Programs.Where(p => p.IsActive)
                            .Select(p => MapProgram(p, counts.GetValueOrDefault(p.ProgramId, 0))).ToList()
    };

    private string? GetClientIp() =>
        HttpContext.Connection.RemoteIpAddress?.ToString();

    private static object AuditEventSnapshot(Event ev) => new
    {
        ev.EventId,
        ev.Name,
        ev.Description,
        ev.Venue,
        ev.VenueAddress,
        ev.BannerUrl,
        ev.AdditionalInfo,
        EventStartDate = ev.EventStartDate.ToString("yyyy-MM-dd"),
        EventEndDate = ev.EventEndDate?.ToString("yyyy-MM-dd"),
        OpenDate = ev.OpenDate.ToString("yyyy-MM-dd"),
        CloseDate = ev.CloseDate.ToString("yyyy-MM-dd"),
        ev.MaxParticipants,
        ev.SponsorInfo,
        ev.ConsentStatement,
        ev.IsSports,
        ev.SportType,
        ev.FixtureMode,
        ev.RegistrationStatus,
        ev.IsActive,
        GalleryUrls = ev.GalleryImages.OrderBy(g => g.SortOrder).Select(g => g.ImageUrl).ToList(),
    };

    private static object AuditProgramSnapshot(TrsProgram p) => new
    {
        p.ProgramId,
        p.EventId,
        p.Name,
        p.Type,
        p.SbaRankingType,
        p.MinAge,
        p.MaxAge,
        p.Gender,
        p.Fee,
        p.PaymentRequired,
        p.FeeStructure,
        p.TeamMode,
        p.MinPlayers,
        p.MaxPlayers,
        p.MinParticipants,
        p.MaxParticipants,
        p.Status,
        p.IsActive,
        Fields = p.Fields == null
            ? null
            : new
            {
                p.Fields.EnableSbaId,
                p.Fields.EnableDocumentUpload,
                p.Fields.EnableGuardianInfo,
                p.Fields.EnableRemark,
                p.Fields.EnableTshirt,
                p.Fields.RequireSbaId,
                p.Fields.RequireDocumentUpload,
                p.Fields.RequireGuardianInfo,
                p.Fields.RequireRemark,
                p.Fields.RequireTshirt,
            },
        CustomFields = p.CustomFields.OrderBy(cf => cf.SortOrder).Select(cf => new
        {
            cf.Label,
            cf.FieldType,
            cf.IsRequired,
            cf.Options,
            cf.SortOrder,
        }).ToList(),
    };
}
