using System.ComponentModel.DataAnnotations;

namespace TRS_API.Models
{

    public class BadmintonClubRequest
    {
        [Required]
        public string  Name          { get; set; } = null!;

        public string? ContactNumber { get; set; }
        public string? Email         { get; set; }
        public string? Address       { get; set; }
        public string? Country       { get; set; }
    }
}

