using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using TRS_Data.Models;

namespace TRS_API.Services;

public class RegistrationDetailsPdfService
{
    private readonly IWebHostEnvironment _env;

    public RegistrationDetailsPdfService(IWebHostEnvironment env)
    {
        _env = env;
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public async Task<byte[]> GenerateAsync(TRSDbContext db, int registrationId)
    {
        var reg = await db.EventRegistrations
            .Include(r => r.Event)
            .Include(r => r.ParticipantGroups)
                .ThenInclude(g => g.Participants)
                    .ThenInclude(p => p.CustomFieldValues)
            .Include(r => r.Payments)
                .ThenInclude(p => p.Items)
            .FirstOrDefaultAsync(r => r.RegistrationId == registrationId)
            ?? throw new KeyNotFoundException($"Registration {registrationId} not found.");

        var configs = await db.SystemConfigs.AsNoTracking().ToListAsync();
        var cfg = configs.ToDictionary(c => c.ConfigKey, c => c.ConfigValue);
        var orgName = cfg.GetValueOrDefault("appName", "System");
        var orgEmail = cfg.GetValueOrDefault("contactEmail", "");
        var copyright = cfg.GetValueOrDefault("copyrightText", "");
        var logoUrl = cfg.GetValueOrDefault("logoLightUrl", "");
        if (string.IsNullOrWhiteSpace(logoUrl))
            logoUrl = cfg.GetValueOrDefault("logoUrl", "");
        if (string.IsNullOrWhiteSpace(logoUrl))
            logoUrl = cfg.GetValueOrDefault("logoDarkUrl", "");
        if (string.IsNullOrWhiteSpace(logoUrl))
            logoUrl = "/images/app/logo_light_mode.png";

        var logoBytes = await TryReadLogoAsync(logoUrl);
        var payment = reg.Payments.OrderByDescending(p => p.CreatedAt).FirstOrDefault();
        var itemByParticipantId = payment?.Items
            .Where(i => i.ParticipantId.HasValue)
            .ToDictionary(i => i.ParticipantId!.Value) ?? new Dictionary<int, PaymentItem>();
        var itemByGroupId = payment?.Items
            .Where(i => !i.ParticipantId.HasValue)
            .GroupBy(i => i.GroupId)
            .ToDictionary(g => g.Key, g => g.First()) ?? new Dictionary<int, PaymentItem>();

        DateTime ToSingaporeTime(DateTime value)
        {
            var utc = value.Kind == DateTimeKind.Unspecified
                ? DateTime.SpecifyKind(value, DateTimeKind.Utc)
                : value.ToUniversalTime();
            return utc.AddHours(8);
        }

        string FormatDate(DateTime? value) =>
            value.HasValue ? ToSingaporeTime(value.Value).ToString("dd MMM yyyy HH:mm") + " SGT" : "-";

        string FormatDob(DateOnly? value) =>
            value.HasValue ? value.Value.ToString("yyyy-MM-dd") : "-";

        string Display(string? value) =>
            string.IsNullOrWhiteSpace(value) ? "-" : value.Trim();

        string CountryName(string? value)
        {
            var clean = value?.Trim();
            if (string.IsNullOrWhiteSpace(clean)) return "-";

            if (clean.Length == 2 && clean.All(char.IsLetter))
            {
                try
                {
                    return new System.Globalization.RegionInfo(clean.ToUpperInvariant()).EnglishName;
                }
                catch (ArgumentException)
                {
                    return clean;
                }
            }

            return clean;
        }

        string RegReference() =>
            ReceiptNumberGenerator.FallbackRegistrationReference(reg.RegistrationId);

        string StatusLabel(string? status) => status switch
        {
            StatusCodesEx.Registration.Pending => "Pending",
            StatusCodesEx.Registration.Confirmed => "Confirmed",
            StatusCodesEx.Registration.CancelPending => "Cancel Pending",
            StatusCodesEx.Registration.RefundFailed => "Refund Failed",
            StatusCodesEx.Registration.Cancelled => "Cancelled",
            StatusCodesEx.Participant.Active => "Active",
            StatusCodesEx.PaymentItem.Refunded => "Refunded",
            StatusCodesEx.Payment.Success => "Paid",
            StatusCodesEx.Payment.PartiallyRefunded => "Partially Refunded",
            StatusCodesEx.Payment.FullyRefunded => "Refunded",
            StatusCodesEx.Payment.Waived => "Waived",
            StatusCodesEx.Payment.PendingCollection => "Pending Collection",
            StatusCodesEx.Payment.Failed => "Failed",
            null or "" => "-",
            _ => status,
        };

        string ParticipantPaymentStatus(Participant participant, ParticipantGroup group)
        {
            if (itemByParticipantId.TryGetValue(participant.ParticipantId, out var participantItem))
                return StatusLabel(participantItem.ItemStatus);
            if (itemByGroupId.TryGetValue(group.GroupId, out var groupItem))
                return StatusLabel(groupItem.ItemStatus);
            return payment == null ? "-" : StatusLabel(payment.PaymentStatus);
        }

        return Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(36);
                page.DefaultTextStyle(x => x.FontSize(9).FontFamily("Arial"));

                page.Content().Column(col =>
                {
                    col.Spacing(10);

                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            if (logoBytes is { Length: > 0 })
                                c.Item().Height(58).Width(135).Image(logoBytes).FitArea();
                            else
                                c.Item().Text(orgName).FontSize(18).Bold();
                        });

                        row.ConstantItem(220).AlignRight().Column(c =>
                        {
                            c.Item().Text("REGISTRATION DETAILS").FontSize(18).Bold().FontColor(Colors.Blue.Darken2);
                            c.Item().Text($"Registration No. {RegReference()}").FontSize(10).Bold();
                            c.Item().Text($"Generated {FormatDate(DateTime.UtcNow)}").FontSize(8).FontColor(Colors.Grey.Medium);
                        });
                    });

                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Lighten2);

                    col.Item().Table(table =>
                    {
                        table.ColumnsDefinition(cd =>
                        {
                            cd.RelativeColumn();
                            cd.RelativeColumn();
                            cd.RelativeColumn();
                            cd.RelativeColumn();
                        });

                        void Meta(string label, string value)
                        {
                            table.Cell().PaddingRight(10).PaddingBottom(8).Column(c =>
                            {
                                c.Item().Text(label).FontSize(8.5f).Bold().FontColor(Colors.Grey.Medium);
                                c.Item().PaddingTop(3).Text(value).FontSize(10);
                            });
                        }

                        Meta("Event", Display(reg.Event?.Name ?? reg.EventName));
                        Meta("Registration Status", StatusLabel(reg.RegStatus));
                        Meta("Submitted", FormatDate(reg.SubmittedAt));
                        Meta("Payment Status", payment == null ? "-" : StatusLabel(payment.PaymentStatus));
                        Meta("Contact Name", Display(reg.ContactName));
                        Meta("Contact Email", Display(reg.ContactEmail));
                        Meta("Contact Phone", Display(reg.ContactPhone));
                        Meta("Receipt No.", Display(payment?.ReceiptNumber));
                    });

                    foreach (var group in reg.ParticipantGroups.OrderBy(g => g.ProgramName).ThenBy(g => g.GroupId))
                    {
                        col.Item().PaddingTop(6).ShowEntire().Element(section =>
                        {
                            section.Border(1).BorderColor(Colors.Grey.Lighten2).Column(groupCol =>
                            {
                                groupCol.Item()
                                    .Background(Colors.Grey.Lighten4)
                                    .Padding(8)
                                    .Row(row =>
                                    {
                                        row.RelativeItem().Column(c =>
                                        {
                                            c.Item().Text(group.ProgramName).FontSize(11).Bold();
                                            c.Item().Text($"Entry ID: {group.GroupId}").FontSize(8).FontColor(Colors.Grey.Medium);
                                        });
                                        row.ConstantItem(110).AlignRight().Text(StatusLabel(group.GroupStatus)).FontSize(9).Bold();
                                    });

                                groupCol.Item().Padding(8).Table(table =>
                                {
                                    table.ColumnsDefinition(cd =>
                                    {
                                        cd.RelativeColumn();
                                        cd.RelativeColumn();
                                    });

                                    void Meta(string label, string value)
                                    {
                                        table.Cell().PaddingBottom(5).Column(c =>
                                        {
                                            c.Item().Text(label).FontSize(7).Bold().FontColor(Colors.Grey.Medium);
                                            c.Item().Text(value).FontSize(8);
                                        });
                                    }

                                    Meta("Names", Display(group.NamesDisplay));
                                    Meta("Club / School", Display(group.ClubDisplay));
                                });

                                foreach (var participant in group.Participants.OrderBy(p => p.ParticipantId))
                                {
                                    groupCol.Item().PaddingHorizontal(8).PaddingBottom(8).BorderTop(0.5f)
                                        .BorderColor(Colors.Grey.Lighten2).PaddingTop(8).Column(participantCol =>
                                    {
                                        participantCol.Item().Row(row =>
                                        {
                                            row.RelativeItem().Text(participant.FullName).FontSize(10).Bold();
                                            row.ConstantItem(150).AlignRight()
                                                .Text($"{StatusLabel(participant.ParticipantStatus)} / {ParticipantPaymentStatus(participant, group)}")
                                                .FontSize(8).Bold().FontColor(Colors.Grey.Darken1);
                                        });

                                        participantCol.Item().PaddingTop(5).Table(table =>
                                        {
                                            table.ColumnsDefinition(cd =>
                                            {
                                                cd.RelativeColumn();
                                                cd.RelativeColumn();
                                                cd.RelativeColumn();
                                                cd.RelativeColumn();
                                            });

                                            void Field(string label, string value)
                                            {
                                                table.Cell().PaddingBottom(5).PaddingRight(8).Column(c =>
                                                {
                                                    c.Item().Text(label).FontSize(7).Bold().FontColor(Colors.Grey.Medium);
                                                    c.Item().Text(value).FontSize(8);
                                                });
                                            }

                                            Field("DOB", FormatDob(participant.DateOfBirth));
                                            Field("Gender", Display(participant.Gender));
                                            Field("Nationality", CountryName(participant.Nationality));
                                            Field("SBA ID", Display(participant.SbaId));
                                            Field("Email", Display(participant.Email));
                                            Field("Contact", Display(participant.ContactNumber));
                                            Field("T-shirt", Display(participant.TshirtSize));
                                            Field("Guardian", Display(participant.GuardianName));
                                            Field("Guardian Contact", Display(participant.GuardianContact));
                                            Field("Remark", Display(participant.Remark));
                                        });

                                        var customValues = participant.CustomFieldValues
                                            .OrderBy(v => v.CustomFieldId)
                                            .ToList();
                                        if (customValues.Count > 0)
                                        {
                                            participantCol.Item().PaddingTop(2).Text("Custom Fields")
                                                .FontSize(7).Bold().FontColor(Colors.Grey.Medium);
                                            participantCol.Item().PaddingTop(3).Table(table =>
                                            {
                                                table.ColumnsDefinition(cd =>
                                                {
                                                    cd.RelativeColumn();
                                                    cd.RelativeColumn();
                                                });

                                                foreach (var value in customValues)
                                                {
                                                    table.Cell().PaddingBottom(4).PaddingRight(8).Column(c =>
                                                    {
                                                        c.Item().Text(Display(value.FieldLabel)).FontSize(7).Bold().FontColor(Colors.Grey.Medium);
                                                        c.Item().Text(Display(value.FieldValue)).FontSize(8);
                                                    });
                                                }
                                            });
                                        }
                                    });
                                }
                            });
                        });
                    }

                    col.Item().PaddingTop(8).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
                    col.Item().Row(row =>
                    {
                        row.RelativeItem()
                            .Text(!string.IsNullOrWhiteSpace(copyright)
                                ? copyright
                                : $"System-generated registration details - {orgName}")
                            .FontSize(8).Italic().FontColor(Colors.Grey.Medium);
                        if (!string.IsNullOrWhiteSpace(orgEmail))
                            row.ConstantItem(190).AlignRight().Text($"Enquiries: {orgEmail}")
                                .FontSize(8).FontColor(Colors.Grey.Medium);
                    });
                });
            });
        }).GeneratePdf();
    }

    private async Task<byte[]?> TryReadLogoAsync(string logoUrl)
    {
        if (string.IsNullOrWhiteSpace(logoUrl) || _env.WebRootPath == null)
            return null;

        try
        {
            var uri = new Uri(logoUrl, UriKind.RelativeOrAbsolute);
            var filePath = uri.IsAbsoluteUri ? uri.AbsolutePath : logoUrl;
            var localPath = Path.Combine(
                _env.WebRootPath,
                filePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));

            return File.Exists(localPath) ? await File.ReadAllBytesAsync(localPath) : null;
        }
        catch
        {
            return null;
        }
    }
}
