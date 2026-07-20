using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using TRS_API.BackgroundJobs;
using TRS_API.Services;
using TRS_Data.Models;
using Microsoft.OpenApi.Models;
using Serilog;
using Serilog.Events;

var builder = WebApplication.CreateBuilder(args);

// ── Services ──────────────────────────────────────────────────────────────────
builder.Services.AddControllers(options =>
{
    // Automatically return 400 ValidationProblem for any [Required], [EmailAddress],
    // [MinLength], [Range] etc. annotation failures — no manual ModelState checks needed.
    options.Filters.Add<TRS_API.Filters.ValidateModelFilter>();
})
.AddJsonOptions(options =>
{
    // Ensure all JSON responses use camelCase to match TypeScript frontend expectations.
    // This covers shorthand property serialization (e.g. p.FullName -> "fullName").
    options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    options.JsonSerializerOptions.DictionaryKeyPolicy  = System.Text.Json.JsonNamingPolicy.CamelCase;
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddMemoryCache();
builder.Services.AddSwaggerGen(c =>
{
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
    });

    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });


    c.CustomSchemaIds(t => t.FullName);
});

// Database
builder.Services.AddDbContext<TRSDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("TRSConnection")));

// JWT Authentication
var jwtSecret = builder.Configuration["Jwt:Secret"]
    ?? throw new InvalidOperationException("Jwt:Secret is not configured.");

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options => {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            // Map ClaimTypes.Role so [Authorize(Roles=...)] works correctly
            RoleClaimType = System.Security.Claims.ClaimTypes.Role,
            ClockSkew = TimeSpan.FromMinutes(2),  // small tolerance for clock drift
        };
    });
builder.Services.AddAuthorization();

// App services
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<AdminAuditService>();
builder.Services.AddScoped<FixtureGenerationService>();
builder.Services.AddScoped<RegistrationWorkflowService>();
builder.Services.AddScoped<ProgramImportService>();
builder.Services.AddScoped<PaymentFinalizationService>();
builder.Services.AddScoped<PaymentAttemptService>();
builder.Services.AddSingleton<IBackgroundJobQueue, BackgroundJobQueue>();
builder.Services.AddHostedService<BackgroundJobWorker>();
builder.Services.AddHostedService<PaymentCleanupWorker>();
builder.Services.AddScoped<EmailService>();
builder.Services.AddScoped<ReceiptService>();
builder.Services.AddScoped<RegistrationDetailsPdfService>();


// CORS
var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? Array.Empty<string>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
        policy
            .WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials()
    );
});

// Rate Limiting
builder.Services.AddRateLimiter(options =>
    options.AddFixedWindowLimiter("payment", opt => {
        opt.Window = TimeSpan.FromMinutes(builder.Configuration.GetValue<int>("RateLimiting:WindowMinutes", 1));
        opt.PermitLimit = builder.Configuration.GetValue<int>("RateLimiting:PermitLimit", 5);
    }));

builder.Host.UseSerilog((context, services, loggerConfiguration) => loggerConfiguration
    .ReadFrom.Configuration(context.Configuration)
    .WriteTo.Console()
    .WriteTo.Sink(new EFCoreSink(services),
        restrictedToMinimumLevel: LogEventLevel.Warning));

var app = builder.Build();


// ── Middleware ────────────────────────────────────────────────────────────────

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

// Security headers
app.Use(async (ctx, next) => {
    var isDev = app.Environment.IsDevelopment();
    ctx.Response.Headers["Content-Security-Policy"] =
        "default-src 'self'; " +
        "script-src 'self' https://js.stripe.com; " +
        "frame-src https://js.stripe.com; " +
        (isDev ? "connect-src 'self' https://localhost:7183 https://*.stripe.com;"
               : "connect-src 'self' https://*.stripe.com;");
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    ctx.Response.Headers["X-Frame-Options"] = "SAMEORIGIN";
    ctx.Response.Headers["X-XSS-Protection"] = "1; mode=block";
    await next();
});



app.UseCors("AllowFrontend");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseStaticFiles();  // serves TRS_API/wwwroot/** at root URL
app.MapControllers();
app.Run();
