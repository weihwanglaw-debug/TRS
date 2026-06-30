using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TRS_API.Models;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS_API.Controllers;

[ApiController]
[Route("api/clubs")]
public class BadmintonClubsController : ControllerBase
{
    private readonly TRSDbContext _db;
    private readonly AdminAuditService _audit;
    private readonly ILogger<BadmintonClubsController> _logger;

    public BadmintonClubsController(TRSDbContext db, AdminAuditService audit, ILogger<BadmintonClubsController> logger)
    {
        _db     = db;
        _audit  = audit;
        _logger = logger;
    }

    // ── GET /api/clubs ─────────────────────────────────────────────────────────
    // Public — used by ParticipantFieldsForm dropdown on badminton events.
    // Returns active clubs ordered by name.
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? search)
    {
        var q = _db.BadmintonClubs
            .Where(c => c.IsActive);

        if (!string.IsNullOrWhiteSpace(search))
            q = q.Where(c => c.Name.Contains(search));

        var clubs = await q
            .OrderBy(c => c.Name)
            .Select(c => new BadmintonClub
            {
                ClubId        = c.ClubId,
                Name          = c.Name,
                ContactNumber = c.ContactNumber,
                Email         = c.Email,
                Address       = c.Address,
                Country       = c.Country,
            })
            .ToListAsync();

        return Ok(clubs);
    }

    // ── GET /api/clubs/:id ─────────────────────────────────────────────────────
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var club = await _db.BadmintonClubs.FindAsync(id);
        if (club == null || !club.IsActive)
            return NotFound(new { code = "NOT_FOUND", message = "Club not found." });

        return Ok(new BadmintonClub
        {
            ClubId        = club.ClubId,
            Name          = club.Name,
            ContactNumber = club.ContactNumber,
            Email         = club.Email,
            Address       = club.Address,
            Country       = club.Country,
        });
    }

    // ── POST /api/clubs ────────────────────────────────────────────────────────
    [HttpPost, Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> Create([FromBody] BadmintonClubRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { code = "NAME_REQUIRED", message = "Club name is required." });

        var duplicate = await _db.BadmintonClubs
            .AnyAsync(c => c.Name.ToLower() == req.Name.Trim().ToLower() && c.IsActive);
        if (duplicate)
            return Conflict(new { code = "DUPLICATE_NAME", message = "A club with this name already exists." });

        var club = new BadmintonClub
        {
            Name          = req.Name.Trim(),
            ContactNumber = req.ContactNumber?.Trim(),
            Email         = req.Email?.Trim(),
            Address       = req.Address?.Trim(),
            Country       = req.Country?.Trim(),
            IsActive      = true,
            CreatedAt     = DateTime.UtcNow,
        };

        _db.BadmintonClubs.Add(club);
        await _db.SaveChangesAsync();

        await _audit.LogAsync(
            User,
            GetClientIp(),
            "BADMINTON_CLUB_CREATE",
            "BadmintonClub",
            club.ClubId.ToString(),
            null,
            AuditClubSnapshot(club),
            $"Created badminton club '{club.Name}'.");

        _logger.LogInformation("Club {ClubId} '{Name}' created by {User}",
            club.ClubId, club.Name, User.Identity?.Name);

        return Ok(new BadmintonClub
        {
            ClubId        = club.ClubId,
            Name          = club.Name,
            ContactNumber = club.ContactNumber,
            Email         = club.Email,
            Address       = club.Address,
            Country       = club.Country,
        });
    }

    // ── PUT /api/clubs/:id ─────────────────────────────────────────────────────
    [HttpPut("{id:int}"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> Update(int id, [FromBody] BadmintonClubRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { code = "NAME_REQUIRED", message = "Club name is required." });

        var club = await _db.BadmintonClubs.FindAsync(id);
        if (club == null || !club.IsActive)
            return NotFound(new { code = "NOT_FOUND", message = "Club not found." });

        var oldValue = AuditClubSnapshot(club);

        var duplicate = await _db.BadmintonClubs
            .AnyAsync(c => c.Name.ToLower() == req.Name.Trim().ToLower()
                        && c.IsActive
                        && c.ClubId != id);
        if (duplicate)
            return Conflict(new { code = "DUPLICATE_NAME", message = "A club with this name already exists." });

        club.Name          = req.Name.Trim();
        club.ContactNumber = req.ContactNumber?.Trim();
        club.Email         = req.Email?.Trim();
        club.Address       = req.Address?.Trim();
        club.Country       = req.Country?.Trim();
        club.UpdatedAt     = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        await _audit.LogAsync(
            User,
            GetClientIp(),
            "BADMINTON_CLUB_UPDATE",
            "BadmintonClub",
            club.ClubId.ToString(),
            oldValue,
            AuditClubSnapshot(club),
            $"Updated badminton club '{club.Name}'.");

        _logger.LogInformation("Club {ClubId} '{Name}' updated by {User}",
            club.ClubId, club.Name, User.Identity?.Name);

        return Ok(new BadmintonClub
        {
            ClubId        = club.ClubId,
            Name          = club.Name,
            ContactNumber = club.ContactNumber,
            Email         = club.Email,
            Address       = club.Address,
            Country       = club.Country,
        });
    }

    // ── DELETE /api/clubs/:id ──────────────────────────────────────────────────
    // Soft delete only — existing participant records that reference the club
    // name as a string are unaffected.
    [HttpDelete("{id:int}"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> Delete(int id)
    {
        var club = await _db.BadmintonClubs.FindAsync(id);
        if (club == null || !club.IsActive)
            return NotFound(new { code = "NOT_FOUND", message = "Club not found." });

        var oldValue = AuditClubSnapshot(club);

        club.IsActive  = false;
        club.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        await _audit.LogAsync(
            User,
            GetClientIp(),
            "BADMINTON_CLUB_DELETE",
            "BadmintonClub",
            club.ClubId.ToString(),
            oldValue,
            AuditClubSnapshot(club),
            $"Soft-deleted badminton club '{club.Name}'.");

        _logger.LogInformation("Club {ClubId} '{Name}' soft-deleted by {User}",
            club.ClubId, club.Name, User.Identity?.Name);

        return Ok();
    }

    private string? GetClientIp() => HttpContext.Connection.RemoteIpAddress?.ToString();

    private static object AuditClubSnapshot(BadmintonClub club) => new
    {
        club.ClubId,
        club.Name,
        club.ContactNumber,
        club.Email,
        club.Address,
        club.Country,
        club.IsActive,
        club.CreatedAt,
        club.UpdatedAt,
    };
}

