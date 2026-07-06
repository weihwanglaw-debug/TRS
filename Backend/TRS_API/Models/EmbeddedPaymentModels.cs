using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace TRS_API.Models;

public sealed class EmbeddedPaymentAttemptRequest
{
    [Required] public JsonElement RegistrationPayload { get; set; }
    public string? PaymentMethod { get; set; }
    public string? AttemptKey { get; set; }
}
