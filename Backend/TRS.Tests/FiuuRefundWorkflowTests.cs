using Microsoft.EntityFrameworkCore;
using TRS_API.Services.Payments;
using TRS_Data.Models;

namespace TRS.Tests;

public sealed class FiuuRefundWorkflowTests
{
    [Theory]
    [InlineData("FIUU_PR014", true)]
    [InlineData("FIUU_PR001", true)]
    [InlineData("FIUU_PR020", true)]
    [InlineData("FIUU_PR015", false)]
    [InlineData("FIUU_PR016", false)]
    [InlineData("FIUU_INQ006", false)]
    [InlineData("FIUU_REQUEST_UNCERTAIN", false)]
    [InlineData("FIUU_INVALID_SIGNATURE", false)]
    [InlineData("FIUU_INVALID_RESPONSE", false)]
    public void Only_documented_definite_rejections_allow_a_failed_submission(string code, bool rejected)
        => Assert.Equal(rejected, FiuuRefundService.IsDefiniteRejection(code));

    [Theory]
    [InlineData("fiuu:123", "123")]
    [InlineData("fiuu:12345678901234567890", "12345678901234567890")]
    public void Original_transaction_reference_is_provider_scoped(string reference, string expected)
        => Assert.Equal(expected, FiuuRefundService.TransactionId(reference));

    [Theory]
    [InlineData("pi_123")]
    [InlineData("123")]
    [InlineData("fiuu:")]
    [InlineData("fiuu:12x")]
    [InlineData("fiuu:123456789012345678901")]
    public void Invalid_or_other_provider_references_are_rejected(string reference)
        => Assert.Throws<PaymentGatewayException>(() => FiuuRefundService.TransactionId(reference));

    [Theory]
    [InlineData("S", "captured", true)]
    [InlineData("S", "settled", true)]
    [InlineData("S", "authorized", false)]
    [InlineData("S", null, false)]
    [InlineData("P", "captured", false)]
    public void Refund_requires_verified_capture(string status, string? name, bool expected)
        => Assert.Equal(expected, FiuuRefundService.IsCaptured(new("123", "order", 100m, "SGD", status, "00", name)));

    private static (Payment Payment, Refund Refund) Scenario(decimal amount, string reason, string status = "S")
    {
        var registration = new EventRegistration { RegistrationId = 1, RegStatus = "C", RegistrationStatus = "C" };
        var group = new ParticipantGroup { GroupId = 2, GroupStatus = "C", Registration = registration };
        group.Participants.Add(new Participant { ParticipantId = 3, ParticipantStatus = "C" });
        registration.ParticipantGroups.Add(group);
        var payment = new Payment { PaymentId = 4, RegistrationId = 1, Registration = registration, PaymentGateway = "Fiuu", Amount = 100m, PaymentStatus = "S" };
        var item = new PaymentItem { PaymentItemId = 5, PaymentId = 4, Payment = payment, GroupId = 2, Group = group, Amount = 100m, ItemStatus = "S" };
        payment.Items.Add(item);
        var refund = new Refund { RefundId = 6, PaymentId = 4, Payment = payment, PaymentItemId = 5, RefundAmount = amount, RefundStatus = status, RefundReason = reason, CreatedAt = DateTime.UtcNow };
        payment.Refunds.Add(refund);
        return (payment, refund);
    }

    [Theory]
    [InlineData(40, "PR", "S")]
    [InlineData(100, "FR", "R")]
    public void Refund_only_updates_totals_without_cancelling_registration(int amount, string paymentStatus, string itemStatus)
    {
        var (payment, refund) = Scenario(amount, "Goodwill refund");
        FiuuRefundService.ApplyRegistrationOutcome(payment, refund);
        FiuuRefundService.ApplyRegistrationOutcome(payment, refund); // Recalculation must not double-count.
        Assert.Equal(paymentStatus, payment.PaymentStatus);
        Assert.Equal(itemStatus, payment.Items.Single().ItemStatus);
        Assert.Equal("C", payment.Registration.RegStatus);
        Assert.Equal("C", payment.Registration.ParticipantGroups.Single().Participants.Single().ParticipantStatus);
    }

    [Theory]
    [InlineData("P", "CP", "C", "S")]
    [InlineData("F", "RF", "C", "S")]
    [InlineData("S", "X", "X", "FR")]
    public void Whole_registration_cancels_only_after_success(string refundStatus, string registrationStatus, string participantStatus, string paymentStatus)
    {
        var (payment, refund) = Scenario(100m, "Cancelled registration: requested", refundStatus);
        FiuuRefundService.ApplyRegistrationOutcome(payment, refund);
        Assert.Equal(registrationStatus, payment.Registration.RegStatus);
        Assert.Equal(participantStatus, payment.Registration.ParticipantGroups.Single().Participants.Single().ParticipantStatus);
        Assert.Equal(paymentStatus, payment.PaymentStatus);
    }

    [Fact]
    public void Participant_cancellation_leaves_other_participant_active()
    {
        var (payment, refund) = Scenario(50m, "Cancelled participant: requested");
        payment.Items.Single().ParticipantId = 3;
        payment.Items.Single().Amount = 50m;
        var group = payment.Registration.ParticipantGroups.Single();
        group.Participants.Add(new Participant { ParticipantId = 7, ParticipantStatus = "C" });
        FiuuRefundService.ApplyRegistrationOutcome(payment, refund);
        Assert.Equal("X", group.Participants.Single(p => p.ParticipantId == 3).ParticipantStatus);
        Assert.Equal("C", group.Participants.Single(p => p.ParticipantId == 7).ParticipantStatus);
        Assert.Equal("C", group.GroupStatus);
        Assert.Equal("C", payment.Registration.RegStatus);
    }

    [Fact]
    public void Pending_and_failed_refunds_are_excluded_from_totals()
    {
        var (payment, refund) = Scenario(25m, "Goodwill");
        payment.Refunds.Add(new Refund { PaymentItemId = 5, RefundAmount = 75m, RefundStatus = "P" });
        payment.Refunds.Add(new Refund { PaymentItemId = 5, RefundAmount = 75m, RefundStatus = "F" });
        FiuuRefundService.ApplyRegistrationOutcome(payment, refund);
        Assert.Equal("PR", payment.PaymentStatus);
        Assert.Equal("S", payment.Items.Single().ItemStatus);
    }

    [Fact]
    public void Refund_tracking_is_nullable_and_request_identity_unique_per_provider()
    {
        using var db = new TRSDbContext(new DbContextOptionsBuilder<TRSDbContext>().UseSqlServer("Server=unused;Database=unused;Integrated Security=true").Options);
        var model = db.Model.FindEntityType(typeof(Refund))!;
        Assert.True(model.FindProperty(nameof(Refund.GatewayRequestId))!.IsNullable);
        Assert.True(model.FindProperty(nameof(Refund.GatewaySubmittedAt))!.IsNullable);
        var index = model.GetIndexes().Single(i => i.GetDatabaseName() == "UQ_Refunds_GatewayRequest");
        Assert.True(index.IsUnique);
        Assert.Equal(new[] { "PaymentGateway", "GatewayRequestId" }, index.Properties.Select(p => p.Name));
        Assert.Equal("[GatewayRequestId] IS NOT NULL", index.GetFilter());
    }
}
