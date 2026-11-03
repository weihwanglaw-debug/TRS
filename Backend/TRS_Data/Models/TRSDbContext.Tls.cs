using Microsoft.EntityFrameworkCore;

namespace TRS_Data.Models;

public partial class TRSDbContext
{
    public DbSet<TlsLiveSnapshot> TlsLiveSnapshots => Set<TlsLiveSnapshot>();
    public DbSet<TlsResultSnapshot> TlsResultSnapshots => Set<TlsResultSnapshot>();

    private static void ConfigureTlsSnapshots(ModelBuilder mb)
    {
        mb.Entity<TlsLiveSnapshot>(e => {
            e.HasKey(x => x.EventId);
            e.Property(x => x.PayloadJson).HasColumnType("nvarchar(max)");
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
        });
        mb.Entity<TlsResultSnapshot>(e => {
            e.HasKey(x => x.ProgramId);
            e.Property(x => x.PayloadJson).HasColumnType("nvarchar(max)");
            e.HasIndex(x => x.EventId);
            e.HasOne<TrsProgram>().WithMany().HasForeignKey(x => x.ProgramId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.NoAction);
        });
    }
}
