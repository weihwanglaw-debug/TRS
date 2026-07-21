using TRS_API.Models;
using TRS_Data.Models;

namespace TRS_API.Services;

public sealed class AdminPaymentOutcomeService
{
    private static readonly string[] AllowedStatuses =
    {
        StatusCodesEx.Payment.Success,
        StatusCodesEx.Payment.Waived,
        StatusCodesEx.Payment.PendingCollection,
    };

    private static readonly string[] AllowedMethods =
    {
        "Cash",
        "BankTransfer",
        "PayNow",
        "Others",
    };

    public RegistrationWorkflowResult<AdminPaymentOutcome> Normalize(
        string? paymentStatus,
        string? method,
        string? paymentReference)
    {
        var status = paymentStatus?.Trim() ?? "";
        if (!AllowedStatuses.Contains(status))
            return RegistrationWorkflowResult<AdminPaymentOutcome>.Fail("INVALID_STATUS", "PaymentStatus must be S, W, or PC.");

        var normalizedMethod = string.IsNullOrWhiteSpace(method) ? null : method.Trim();
        var normalizedReference = string.IsNullOrWhiteSpace(paymentReference) ? null : paymentReference.Trim();

        if (status == StatusCodesEx.Payment.Success)
        {
            if (normalizedMethod == null)
                return RegistrationWorkflowResult<AdminPaymentOutcome>.Fail("INVALID_METHOD", "Payment method is required when payment status is Paid.");

            if (!AllowedMethods.Contains(normalizedMethod))
                return RegistrationWorkflowResult<AdminPaymentOutcome>.Fail("INVALID_METHOD", "Payment method must be Cash, BankTransfer, PayNow, or Others.");

            return RegistrationWorkflowResult<AdminPaymentOutcome>.Ok(new AdminPaymentOutcome(status, normalizedMethod, normalizedReference));
        }

        return RegistrationWorkflowResult<AdminPaymentOutcome>.Ok(new AdminPaymentOutcome(status, null, null));
    }

    public void ApplyOutcome(
        Payment payment,
        AdminPaymentOutcome outcome,
        string? adminNote,
        int? receiptProgramId)
    {
        var now = DateTime.UtcNow;
        payment.PaymentMethod = outcome.Method;
        payment.PaymentStatus = outcome.PaymentStatus;
        payment.AdminNote = BuildAdminNote(adminNote, outcome.PaymentReference);
        payment.UpdatedAt = now;

        if (outcome.PaymentStatus == StatusCodesEx.Payment.Success)
        {
            payment.PaidAt = now;
            if (string.IsNullOrWhiteSpace(payment.ReceiptNumber))
                payment.ReceiptNumber = ReceiptNumberGenerator.Generate(payment.EventId, receiptProgramId);
        }
        else
        {
            payment.PaidAt = null;
        }
    }

    private static string? BuildAdminNote(string? adminNote, string? paymentReference)
    {
        var note = adminNote?.Trim();
        var reference = paymentReference?.Trim();

        if (string.IsNullOrWhiteSpace(reference))
            return string.IsNullOrWhiteSpace(note) ? null : note;

        return string.IsNullOrWhiteSpace(note)
            ? $"Payment reference: {reference}"
            : $"{note}{Environment.NewLine}Payment reference: {reference}";
    }
}

public sealed record AdminPaymentOutcome(string PaymentStatus, string? Method, string? PaymentReference);
