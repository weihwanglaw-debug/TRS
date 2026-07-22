using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TRS_API.Models;
using TRS_Data.Models;

namespace TRS_API.Controllers;

[ApiController, Route("api/config")]
public class ConfigController : ControllerBase
{
    private readonly TRSDbContext _db;
    public ConfigController(TRSDbContext db) => _db = db;

    // GET /api/config  — public
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var rows = await _db.SystemConfigs.ToListAsync();
        var dict = new Dictionary<string, string>
        {
            ["logoLightUrl"] = "/images/app/logo_light_mode.png",
            ["logoDarkUrl"] = "/images/app/logo_dark_mode.png",
            ["displayTimeZone"] = "+08:00",
            ["displayDateTimeFormat"] = "dd/MM/yyyy HH:mm:ss",
            ["socialFacebookUrl"] = "https://www.facebook.com/WyseActiveHub/",
            ["socialInstagramUrl"] = "https://www.instagram.com/wyse.active/",
            ["socialYoutubeUrl"] = "",
            ["socialLinkedInUrl"] = "https://sg.linkedin.com/company/wyse-active-pte-ltd",
            ["socialTiktokUrl"] = "",
        };
        foreach (var row in rows)
        {
            dict[row.ConfigKey] = row.ConfigValue;
        }
        return Ok(dict);
    }

    // PUT /api/config  — admin
    [HttpPut, Authorize(Roles = "superadmin")]
    public async Task<IActionResult> Update([FromBody] UpdateConfigRequest req)
    {
        foreach (var (key, value) in req.Updates)
        {
            var row = await _db.SystemConfigs.FindAsync(key);
            if (row != null) {
                row.ConfigValue = value;
                row.UpdatedAt   = DateTime.UtcNow;
            } else {
                _db.SystemConfigs.Add(new SystemConfig {
                    ConfigKey = key, ConfigValue = value, UpdatedAt = DateTime.UtcNow
                });
            }
        }
        await _db.SaveChangesAsync();
        return await Get();
    }
}
