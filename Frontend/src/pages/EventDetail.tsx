import { useState, useMemo, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar, MapPin, Users, Download, ArrowLeft,
  ShoppingCart, Plus, Trash2, AlertCircle, Edit2,
  Search, ChevronLeft, ChevronRight, X, Trophy,
  BadgeInfo, CalendarDays, UserRound, FileText, Images, ListChecks, ClipboardList,
} from "lucide-react";
import type { TournamentEvent, Program, Participant, CartEntry } from "@/types/config";
import { getEventStatus, formatDate } from "@/lib/eventUtils";
import { apiGetEvent, apiGetSbaMember, apiCreateRegistration, apiCreateEmbeddedPaymentAttempt, apiConfirmRegistration, apiUploadFile, assetUrl } from "@/lib/api";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import StatusBadge, { getProgramCapacityStatus } from "@/components/events/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { NATIONALITY_OPTIONS } from "@/lib/countries";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { Switch } from "@/components/ui/switch";
import ParticipantFieldsForm, {
  blankParticipantFormValues,
  validateParticipant,
  MONTHS, DAYS, YEARS,
} from "@/components/registration/ParticipantFieldsForm";
import EmbeddedPaymentModal from "@/components/registration/EmbeddedPaymentModal";
import type { EmbeddedPaymentAttempt } from "@/types/registration";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

import eventBanner1 from "@/assets/event-banner-1.jpg";
import eventBanner2 from "@/assets/event-banner-2.jpg";
import eventBanner3 from "@/assets/event-banner-3.jpg";

const FALLBACK_BANNERS = [eventBanner1, eventBanner2, eventBanner3];

type EventSectionNavItem = {
  id: string;
  label: string;
  icon: React.ElementType;
};

// MONTHS, DAYS, YEARS imported from ParticipantFieldsForm
function generateId() { return Math.random().toString(36).slice(2, 10); }

function blankParticipant(): Participant {
  return { id: generateId(), ...blankParticipantFormValues() };
}

// ── Gallery Component with swipe support ──
function EventGallery({ images }: { images: string[] }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [swipeDir, setSwipeDir] = useState<1 | -1>(1);
  const touchStart = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStart.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart.current === null || lightboxIdx === null) return;
    const diff = touchStart.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      if (diff > 0) { setSwipeDir(1); setLightboxIdx((lightboxIdx + 1) % images.length); }
      else { setSwipeDir(-1); setLightboxIdx((lightboxIdx - 1 + images.length) % images.length); }
    }
    touchStart.current = null;
  };

  const goNext = (e: React.MouseEvent) => { e.stopPropagation(); setSwipeDir(1); setLightboxIdx(prev => ((prev ?? 0) + 1) % images.length); };
  const goPrev = (e: React.MouseEvent) => { e.stopPropagation(); setSwipeDir(-1); setLightboxIdx(prev => ((prev ?? 0) - 1 + images.length) % images.length); };

  if (images.length === 0) return null;

  const MAX_VISIBLE = 6;
  const visibleImages = showAll ? images : images.slice(0, MAX_VISIBLE);
  const hasMore = images.length > MAX_VISIBLE && !showAll;

  return (
    <div className="mb-12">
      <h2 className="font-bold text-xl mb-6">Gallery</h2>
      {images.length === 1 ? (
        <div
          className="relative w-full overflow-hidden cursor-pointer group"
          style={{ border: "1px solid var(--color-table-border)", maxHeight: "400px" }}
          onClick={() => setLightboxIdx(0)}
        >
          <img src={images[0]} alt="Event gallery" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-300" />
        </div>
      ) : (
        <>
          <div className={`grid gap-3 ${
            images.length === 2 ? "grid-cols-2" :
            "grid-cols-2 md:grid-cols-3"
          }`}>
            {visibleImages.map((img, i) => (
              <div
                key={i}
                className="relative overflow-hidden cursor-pointer group"
                style={{ border: "1px solid var(--color-table-border)" }}
                onClick={() => { setLightboxIdx(i); setSwipeDir(1); }}
              >
                <div className="aspect-video">
                  <img src={img} alt={`Gallery ${i + 1}`}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                </div>
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-300 flex items-center justify-center">
                  <Search className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>
                {/* Show remaining count on last visible */}
                {hasMore && i === MAX_VISIBLE - 1 && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <span className="text-white text-lg font-bold">+{images.length - MAX_VISIBLE}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {hasMore && (
            <button onClick={() => setShowAll(true)}
              className="mt-3 text-sm font-medium" style={{ color: "var(--color-primary)" }}>
              Show all {images.length} photos
            </button>
          )}
        </>
      )}

      {/* Lightbox with swipe */}
      <AnimatePresence>
        {lightboxIdx !== null && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightboxIdx(null)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {/* Close */}
            <button className="absolute top-4 right-4 p-2.5 text-white/60 hover:text-white z-10 bg-black/30 hover:bg-black/50 transition-all" onClick={() => setLightboxIdx(null)}>
              <X className="h-5 w-5" />
            </button>

            {/* Prev/Next arrows — hidden on mobile (use swipe) */}
            {images.length > 1 && (
              <>
                <button className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/60 hover:text-white z-10 bg-black/30 hover:bg-black/50 transition-all items-center justify-center"
                  onClick={goPrev}>
                  <ChevronLeft className="h-7 w-7" />
                </button>
                <button className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/60 hover:text-white z-10 bg-black/30 hover:bg-black/50 transition-all items-center justify-center"
                  onClick={goNext}>
                  <ChevronRight className="h-7 w-7" />
                </button>
              </>
            )}

            {/* Image with slide animation */}
            <motion.img
              key={lightboxIdx}
              src={images[lightboxIdx]}
              alt=""
              className="max-w-full max-h-[85vh] object-contain px-4 md:px-20 select-none"
              initial={{ opacity: 0, x: swipeDir * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: swipeDir * -60 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              onClick={e => e.stopPropagation()}
              draggable={false}
            />

            {/* Bottom bar: counter + dots + swipe hint */}
            <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center gap-2 pb-5 pt-3 bg-gradient-to-t from-black/50 to-transparent">
              {/* Dot indicators */}
              {images.length > 1 && images.length <= 12 && (
                <div className="flex gap-1.5">
                  {images.map((_, i) => (
                    <button key={i} onClick={e => { e.stopPropagation(); setSwipeDir(i > lightboxIdx ? 1 : -1); setLightboxIdx(i); }}
                      className="w-1.5 h-1.5 rounded-full transition-all duration-200"
                      style={{ backgroundColor: i === lightboxIdx ? "var(--color-primary)" : "rgba(255,255,255,0.35)" }}
                    />
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3 text-white/50 text-xs">
                <span>{lightboxIdx + 1} / {images.length}</span>
                <span className="md:hidden flex items-center gap-1">
                  <ChevronLeft className="h-3 w-3" /> Swipe <ChevronRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main component ──
function EventDetailSectionNav({ sections }: { sections: EventSectionNavItem[] }) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    if (sections.length === 0) return;

    const observers: IntersectionObserver[] = [];
    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveId(id);
        },
        { rootMargin: "-35% 0px -55% 0px", threshold: 0.01 },
      );
      observer.observe(el);
      observers.push(observer);
    });

    return () => observers.forEach((observer) => observer.disconnect());
  }, [sections]);

  const scrollToSection = (sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (sections.length < 2) return null;

  return (
    <nav className="event-detail-section-nav" aria-label="Event page sections">
      {sections.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={activeId === id ? "is-active" : ""}
          onClick={() => scrollToSection(id)}
          aria-current={activeId === id ? "true" : undefined}
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const registrationRef = useRef<HTMLDivElement>(null);
  const programsRef = useRef<HTMLDivElement>(null);

  const { cfg } = useLiveConfig();

  const [event,        setEvent]        = useState<TournamentEvent | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  // eventIndex only used for fallback banner cycling — default 0 for async load
  const [eventIndex,   setEventIndex]   = useState(0);

  useEffect(() => {
    if (!id) return;
    setEventLoading(true);
    apiGetEvent(id).then(r => {
      if (r.data) {
        setEvent(r.data);
        // index used for fallback banner only — cycle by event id hash
        setEventIndex(id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 3);
      }
    }).finally(() => setEventLoading(false));
  }, [id]);

  // ── Session storage key — scoped per event so different events don't clash ──
  const SESSION_KEY = id ? `trs_cart_${id}` : null;

  // ── Contact person (who submits — receives the receipt email) ─────────────
  interface ContactPerson { name: string; email: string; phone: string; }

  // ── Restore cart + contact from sessionStorage on mount (payment retry flow) ──
  const restoreSession = (): { cart: CartEntry[]; contact: ContactPerson } | null => {
    if (!SESSION_KEY) return null;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Strip documentFile (File objects can't survive serialization)
      if (parsed.cart) {
        parsed.cart = (parsed.cart as CartEntry[]).map(entry => ({
          ...entry,
          participants: entry.participants.map((p: Participant) => ({ ...p, documentFile: null })),
        }));
      }
      return parsed;
    } catch { return null; }
  };

  const savedSession = restoreSession();

  // Registration state
  const [step, setStep] = useState(savedSession ? 3 : 1);  // jump to cart if restoring
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [cart, setCart] = useState<CartEntry[]>(savedSession?.cart ?? []);
  const [editingCartIndex, setEditingCartIndex] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [existingParticipants, setExistingParticipants] = useState<Participant[]>([]);

  // ── Contact person state ──────────────────────────────────────────────────
  const [contact, setContact] = useState<ContactPerson>(
    savedSession?.contact ?? { name: "", email: "", phone: "" }
  );
  const [contactErrors, setContactErrors] = useState<Partial<ContactPerson>>({});
  const [suggestions, setSuggestions] = useState<{ idx: number; matches: Participant[] } | null>(null);
  const [sbaStatus, setSbaStatus] = useState<Record<number, "idle" | "loading" | "found" | "not_found">>({});
  const [adminConfirmOpen, setAdminConfirmOpen] = useState(false);
  const [adminConfirmStatus, setAdminConfirmStatus] = useState<"S" | "W" | "PC">("S");
  const [adminConfirmMethod, setAdminConfirmMethod] = useState("Cash");
  const [adminConfirmNote, setAdminConfirmNote] = useState("");
  const [adminConfirmRef, setAdminConfirmRef] = useState("");

  const status = event ? getEventStatus(event) : "closed";
  const currency = cfg.currency || "SGD";
  const totalPrice = cart.reduce((sum, e) => sum + e.fee, 0);
  // checkout submission state
  const [submitting,    setSubmitting]    = useState(false);
  const [submitError,   setSubmitError]   = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "paynow">("card");
  const [paymentAttempt, setPaymentAttempt] = useState<EmbeddedPaymentAttempt | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const cartRequiresPayment = cart.some(e => {
    const prog = event?.programs.find(p => p.id === e.programId);
    return prog?.paymentRequired && e.fee > 0;
  });
  const getCartEntryCount = (programId: string, excludeIndex: number | null = null) =>
    cart.filter((entry, index) => entry.programId === programId && index !== excludeIndex).length;
  const isAdminPaymentBypass = isAuthenticated && cartRequiresPayment;
  const canSubmitCart = isAdminPaymentBypass || consentChecked;
  const registrationContact = isAdminPaymentBypass
    ? {
        name: user?.name?.trim() || user?.email || "Admin",
        email: user?.email || contact.email,
        phone: "",
      }
    : contact;
  const showAdminPaymentDetails = adminConfirmStatus === "S";

  const bannerImage =
    event?.bannerUrl && !event.bannerUrl.startsWith("blob:")
      ? assetUrl(event.bannerUrl)
      : FALLBACK_BANNERS[eventIndex % FALLBACK_BANNERS.length];

  const galleryImages = useMemo(() => {
    const safe = (event?.galleryUrls ?? []).filter((u) => u && !u.startsWith("blob:")).map(assetUrl);
    if (safe.length > 0) return safe;
    return FALLBACK_BANNERS;
  }, [event]);

  const sectionNavItems = useMemo<EventSectionNavItem[]>(() => {
    if (!event) return [];
    return [
      { id: "event-info", label: "Info", icon: BadgeInfo },
      ...(event.documents?.length ? [{ id: "event-documents", label: "Docs", icon: FileText }] : []),
      ...(galleryImages.length ? [{ id: "event-gallery", label: "Gallery", icon: Images }] : []),
      { id: "event-categories", label: event.sportType.toLowerCase() === "badminton" ? "Categories" : "Programs", icon: ListChecks },
      ...(status === "open" ? [{ id: "registration", label: "Register", icon: ClipboardList }] : []),
    ];
  }, [event, galleryImages.length, status]);

  // ── Program selection with scroll ──
  // Re-fetches the event before opening the form so that currentParticipants
  // reflects the latest count — prevents showing a stale "Register" button
  // for a program that filled up while the user was browsing.
  const handleSelectProgram = async (prog: Program) => {
    if (!id) return;
    // Optimistically open the form immediately with the data we have
    setSelectedProgram(prog);
    const initial = Array.from({ length: prog.minPlayers }, () => blankParticipant());
    setParticipants(initial);
    setErrors({});
    setFormError("");
    setSbaStatus({});
    setSuggestions(null);
    setStep(2);
    setTimeout(() => {
      registrationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    // Refresh event data in background — if the program is now full,
    // the refreshed selectedProgram will cause validate() to catch it.
    const fresh = await apiGetEvent(id);
    if (fresh.data) {
      setEvent(fresh.data);
      const freshProg = fresh.data.programs.find(p => p.id === prog.id);
      if (freshProg) setSelectedProgram(freshProg);
    }
  };

  // ── Participant field updates ──

  const errorKeysForParticipantPatch = (patch: Partial<Participant>): string[] => {
    const keys = new Set<string>();

    Object.keys(patch).forEach((key) => {
      if (key === "dobDay" || key === "dobMonth" || key === "dobYear") {
        keys.add("dob");
        return;
      }

      if (key === "customFieldValues") {
        keys.add("custom.");
        return;
      }

      keys.add(key);
    });

    return Array.from(keys);
  };

  const clearParticipantErrors = (idx: number, fieldKeys: string[]) => {
    if (fieldKeys.length === 0) return;

    const prefix = `p${idx}.`;
    setErrors((prev) => {
      let changed = false;
      const next = { ...prev };

      fieldKeys.forEach((fieldKey) => {
        if (fieldKey.endsWith(".")) {
          Object.keys(next).forEach((key) => {
            if (key.startsWith(`${prefix}${fieldKey}`)) {
              delete next[key];
              changed = true;
            }
          });
          return;
        }

        const errorKey = `${prefix}${fieldKey}`;
        if (errorKey in next) {
          delete next[errorKey];
          changed = true;
        }
      });

      return changed ? next : prev;
    });

    if (fieldKeys.includes("gender")) {
      setFormError("");
    }
  };



  const applyAutoFill = (participantIdx: number, existing: Participant) => {
    setParticipants((prev) =>
      prev.map((p, i) => i === participantIdx ? { ...existing, id: p.id, documentFile: null } : p)
    );
    clearParticipantErrors(participantIdx, ["sbaId", "fullName", "dob", "gender", "email", "contactNumber", "nationality", "clubSchoolCompany", "tshirtSize", "guardianName", "guardianContact", "documentUpload", "remark", "custom."]);
    setSuggestions(null);
  };

  const addParticipant = () => {
    if (!selectedProgram || participants.length >= selectedProgram.maxPlayers) return;
    setParticipants((prev) => [...prev, blankParticipant()]);
    setFormError("");
  };

  const removeParticipant = (idx: number) => {
    if (!selectedProgram || participants.length <= selectedProgram.minPlayers) return;
    setParticipants((prev) => prev.filter((_, i) => i !== idx));
    setErrors((prev) => {
      const next: Record<string, string> = {};
      Object.entries(prev).forEach(([key, value]) => {
        const match = /^p(\d+)\.(.+)$/.exec(key);
        if (!match) {
          next[key] = value;
          return;
        }

        const participantIndex = Number(match[1]);
        if (participantIndex < idx) next[key] = value;
        else if (participantIndex > idx) next[`p${participantIndex - 1}.${match[2]}`] = value;
      });
      return next;
    });
    setFormError("");
    // Rebuild sbaStatus: participants above the removed index shift down by one
    setSbaStatus((prev) => {
      const next: Record<number, "idle" | "loading" | "found" | "not_found"> = {};
      Object.entries(prev).forEach(([key, val]) => {
        const i = Number(key);
        if (i < idx) next[i] = val;
        else if (i > idx) next[i - 1] = val; // shift down
        // i === idx is dropped
      });
      return next;
    });
  };

  // ── SBA ID retrieve — calls apiGetSbaMember() (sbaApi.ts) ──
  // Mock: resolves from SBA_MASTER in sbaApi.ts
  // Real: swap sbaApi.ts body to fetch() from /api/sba/members/:id
  const retrieveBySbaId = async (idx: number, sbaId: string) => {
    if (!sbaId.trim()) return;
    setSbaStatus((prev) => ({ ...prev, [idx]: "loading" }));
    // Registration lookup: match by SBA ID only — no ranking type filter.
    // Ranking type is only applied during fixture seeding, not here.
    const r = await apiGetSbaMember(sbaId.trim());
    if (r.data) {
      const found = r.data;
      const [year, month, day] = found.dob.split("-");
      setParticipants((prev) =>
        prev.map((p, i) =>
          i === idx ? { ...p, fullName: found.name, dobDay: day,
            dobMonth: MONTHS[parseInt(month, 10) - 1], dobYear: year,
            clubSchoolCompany: found.club } : p
        )
      );
      clearParticipantErrors(idx, ["sbaId", "fullName", "dob", "clubSchoolCompany"]);
      setSbaStatus((prev) => ({ ...prev, [idx]: "found" }));
    } else {
      setSbaStatus((prev) => ({ ...prev, [idx]: "not_found" }));
    }
  };

  // ── Validation — delegates field rules to shared validateParticipant() ──
  const validate = (): boolean => {
    if (!selectedProgram) return false;

    // Program-level checks first
    const cartEntriesForProgram = getCartEntryCount(selectedProgram.id, editingCartIndex);
    if (selectedProgram.currentParticipants + cartEntriesForProgram >= selectedProgram.maxParticipants) {
      setErrors({}); setFormError("This program is full."); return false;
    }

    const allErrs: Record<string, string> = {};
    let formErr = "";

    participants.forEach((p, i) => {
      const px = `p${i}`;
      // Per-participant field validation via shared function
      const perParticipantErrs = validateParticipant(p, {
        program: selectedProgram,
        allValues: participants,
        selfIndex: i,
      });
      // Namespace errors by participant index so they map to the right Field
      for (const [k, v] of Object.entries(perParticipantErrs)) {
        allErrs[`${px}.${k}`] = v;
      }
      // In-cart duplicate check (different from in-submission duplicate above)
      const cartDupe = cart.some((entry, ci) => {
        if (editingCartIndex !== null && ci === editingCartIndex) return false;
        return entry.programId === selectedProgram.id &&
          entry.participants.some(ep =>
            ep.fullName === p.fullName &&
            ep.dobDay === p.dobDay &&
            ep.dobMonth === p.dobMonth &&
            ep.dobYear === p.dobYear
          );
      });
      if (cartDupe && !allErrs[`${px}.fullName`])
        allErrs[`${px}.fullName`] = "Already registered in this program";
    });

    // Mixed gender composition — checked across all participants together
    if (selectedProgram.gender === "Mixed") {
      const allFilled = participants.every(p => p.gender);
      if (!allFilled) {
        formErr = "Please select the gender for all participants.";
      } else {
        const males   = participants.filter(p => p.gender === "Male").length;
        const females = participants.filter(p => p.gender === "Female").length;
        if (males !== 1 || females !== 1)
          formErr = "Mixed program requires exactly 1 Male and 1 Female player.";
      }
    }

    setErrors(allErrs);
    setFormError(formErr);

    // Scroll to first error so user can see it
    const hasErrors = Object.keys(allErrs).length > 0 || !!formErr;
    if (hasErrors) {
      setTimeout(() => {
        registrationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }

    return !hasErrors;
  };

  // ── Add to cart ──
  const addToCart = () => {
    if (!selectedProgram) return;
    const isPerPlayer = selectedProgram.feeStructure === "per_player";
    const entryFee = selectedProgram.paymentRequired ? selectedProgram.fee : 0;
    const totalEntryFee = isPerPlayer ? entryFee * participants.length : entryFee;

    const entry: CartEntry = {
      programId: selectedProgram.id,
      programName: selectedProgram.name,
      fee: totalEntryFee,
      feeStructure: selectedProgram.feeStructure,
      feePerPlayer: isPerPlayer ? entryFee : undefined,
      participants: [...participants],
    };

    if (editingCartIndex !== null) {
      setCart((prev) => prev.map((c, i) => (i === editingCartIndex ? entry : c)));
      setEditingCartIndex(null);
    } else { setCart((prev) => [...prev, entry]); }
    participants.forEach((p) => {
      const exists = existingParticipants.some((ep) =>
        ep.fullName  === p.fullName  &&
        ep.dobDay    === p.dobDay    &&
        ep.dobMonth  === p.dobMonth  &&
        ep.dobYear   === p.dobYear
      );
      if (!exists) setExistingParticipants((prev) => [...prev, { ...p }]);
    });
    setSelectedProgram(null); setParticipants([]); setErrors({}); setFormError(""); setSbaStatus({}); setStep(3);
  };

  const handleAddToCart = () => { if (validate()) addToCart(); };

  // ── Persist checkout context to sessionStorage (survives gateway redirect) ──
  const saveSession = (
    currentCart: CartEntry[],
    currentContact: { name: string; email: string; phone: string },
    payload: object,
  ): boolean => {
    if (!SESSION_KEY) return false;
    try {
      const serializable = {
        cart: currentCart.map(entry => ({
          ...entry,
          participants: entry.participants.map(p => ({ ...p, documentFile: null })),
        })),
        contact: currentContact,
        payload,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(serializable));
      return true;
    } catch {
      return false;
    }
  };

  const clearSession = () => { if (SESSION_KEY) sessionStorage.removeItem(SESSION_KEY); };

  // ── Build registration payload from cart + contact ────────────────────────
  // documentUrlMap: keyed by "entryIndex-participantIndex" → uploaded URL
  const buildRegistrationPayload = (documentUrlMap: Record<string, string> = {}) => {
    const groups = cart.map((entry, i) => {
      const groupId = `PG-TEMP-${i}`;
      const isPerPlayer = entry.feeStructure === "per_player";
      const parts = entry.participants.map((p, pi) => {
        const monthIdx = MONTHS.indexOf(p.dobMonth);
        const dob = p.dobYear && p.dobMonth && p.dobDay
          ? `${p.dobYear}-${String(monthIdx + 1).padStart(2,"0")}-${p.dobDay}`
          : "";
        return {
          id: `PART-TEMP-${i}-${pi}`, participantGroupId: groupId,
          fullName: p.fullName, dob, gender: p.gender,
          nationality: p.nationality, clubSchoolCompany: p.clubSchoolCompany,
          email: p.email, contactNumber: p.contactNumber, tshirtSize: p.tshirtSize,
          sbaId: p.sbaId || undefined, guardianName: p.guardianName || undefined,
          guardianContact: p.guardianContact || undefined, remark: p.remark || undefined,
          documentUrl: documentUrlMap[`${i}-${pi}`] || undefined,
          customFieldValues: p.customFieldValues ?? {},
        };
      });
      const items = isPerPlayer
        ? parts.map((p, pi) => ({
            programName: entry.programName,
            description: `${entry.programName} — ${p.fullName}`,
            playerName: p.fullName,
            amount: entry.feePerPlayer ?? 0,
            participantIndex: pi,  // backend uses this to link to the saved Participant row
          }))
        : [{
            programName: entry.programName,
            description: `${entry.programName} — ${parts.map(p => p.fullName).join(" / ")}`,
            amount: entry.fee,
          }];
      return {
        id: groupId, registrationId: "REG-TEMP", eventId: Number(event!.id),
        programId: Number(entry.programId), programName: entry.programName, fee: entry.fee,
        groupStatus: "Pending" as const, seed: null, participants: parts,
        clubDisplay: parts[0]?.clubSchoolCompany ?? "",
        namesDisplay: parts.map(p => p.fullName).join(" / "),
        items,
      };
    });
    return {
      eventId: Number(event!.id), eventName: event!.name, regStatus: "Pending" as const,
      contactName: registrationContact.name, contactEmail: registrationContact.email, contactPhone: registrationContact.phone,
      groups,
      payment: {
        id: "PAY-TEMP", registrationId: "REG-TEMP", eventId: Number(event!.id),
        gateway: "Stripe" as const, method: totalPrice === 0 ? ("Free" as const) : ("CreditCard" as const),
        amount: totalPrice, currency, paymentStatus: "P" as const,
        createdAt: new Date().toISOString(), items: [],
      },
    };
  };

  const buildPaymentSummaryItems = () =>
    cart.map((entry) => ({
      label: entry.programName,
      detail: entry.participants.map(p => p.fullName).join(" / "),
      amount: entry.fee,
    }));

  const createAttemptKey = () => {
    const randomPart = crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    return `trs_${event!.id}_${Date.now()}_${randomPart}`;
  };

  const handlePaymentConfirmed = async (registrationId: string) => {
    clearSession();
    setCart([]);
    setSelectedProgram(null);
    setParticipants([]);
    setEditingCartIndex(null);
    setPaymentAttempt(null);
    setPaymentModalOpen(false);
    setStep(1);
    setSubmitError("");
    if (id) {
      const fresh = await apiGetEvent(id);
      if (fresh.data) setEvent(fresh.data);
    }
    navigate(`/payment/result?status=success&reg=${registrationId}&direct=paid`);
  };

  // Checkout
  // Paid registrations use embedded Stripe PaymentIntents. The backend validates
  // pricing before creating an attempt, and the webhook is the source of truth
  // for final registration creation.
  const handleCheckout = async () => {
    if (!event || !canSubmitCart) return;

    if (!isAdminPaymentBypass) {
      // Validate contact fields
      const cErrs: { name?: string; email?: string; phone?: string } = {};
      if (!contact.name.trim())  cErrs.name  = "Required";
      if (!contact.email.trim()) cErrs.email = "Required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) cErrs.email = "Invalid email";
      if (!contact.phone.trim()) cErrs.phone = "Required";
      if (Object.keys(cErrs).length) { setContactErrors(cErrs); return; }
    }
    setContactErrors({});

    setSubmitting(true);
    setSubmitError("");
    try {
      // ── Upload documents before building the payload ──────────────────────
      // Collect all participants across all cart entries that have a documentFile.
      // Upload each in parallel, build a map of "entryIdx-participantIdx" → URL.
      const docUploads: Promise<void>[] = [];
      const documentUrlMap: Record<string, string> = {};
      cart.forEach((entry, ei) => {
        entry.participants.forEach((p, pi) => {
          if (p.documentFile) {
            docUploads.push(
              apiUploadFile(p.documentFile, "registrations/documents").then(r => {
                if (r.data) documentUrlMap[`${ei}-${pi}`] = r.data;
                // Non-fatal: if upload fails we still submit; admin can note missing doc.
              })
            );
          }
        });
      });
      if (docUploads.length) await Promise.all(docUploads);

      const registrationPayload = buildRegistrationPayload(documentUrlMap);
      const needsPayment = cart.some(e => e.fee > 0);

      if (!needsPayment) {
        // Free registration — write to DB immediately, no gateway
        const regResult = await apiCreateRegistration(registrationPayload);
        if (regResult.error) { setSubmitError(regResult.error.message); return; }
        clearSession();
        navigate(`/payment/result?status=success&reg=${regResult.data!.id}&direct=free`, {
          state: { directRegistration: regResult.data, directMode: "free" },
        });
        return;
      }

      // Admin registration — skip Payment Gateway, open confirmation modal
      if (isAuthenticated) {
        setAdminConfirmOpen(true);
        return;
      }

      // Ask backend to create a Stripe session only — no DB write yet
      const attemptResult = await apiCreateEmbeddedPaymentAttempt(
        registrationPayload,
        paymentMethod,
        createAttemptKey(),
      );
      if (attemptResult.error) { setSubmitError(attemptResult.error.message); return; }

      const didSaveSession = saveSession(
        cart,
        contact,
        registrationPayload,
      );
      if (!didSaveSession) {
        setSubmitError("We couldn't save your registration details in this browser. Please enable storage and try again.");
        return;
      }

      setPaymentAttempt(attemptResult.data!);
      setPaymentModalOpen(true);

    } finally {
      setSubmitting(false);
    }
  };

  const removeCartEntry = (idx: number) => { setCart((prev) => prev.filter((_, i) => i !== idx)); };
  const editCartEntry = (idx: number) => {
    const entry = cart[idx];
    const prog = event?.programs.find((p) => p.id === entry.programId);
    if (!prog) return;
    // documentFile is null after session restore (File objects can't be serialized).
    // documentUrl is preserved in the participant record — ParticipantFieldsForm will
    // show the existing file link so the user knows it is still attached.
    setSelectedProgram(prog); setParticipants([...entry.participants]); setEditingCartIndex(idx);
    setErrors({}); setFormError(""); setSbaStatus({}); setSuggestions(null); setStep(2);
    setTimeout(() => registrationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };
  const scrollToPrograms = () => {
    programsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (eventLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <PageLoader label="Loading event…" />
        </main>
        <Footer />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center pt-16">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Event Not Found</h1>
            <button onClick={() => navigate("/")} className="btn-primary px-5 py-2.5 text-sm">Back to Home</button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="event-detail-shell min-h-screen flex flex-col">
      <Header />
      <EventDetailSectionNav sections={sectionNavItems} />
      <main className="flex-1" style={{ backgroundColor: "var(--color-page-bg)" }}>

        {/* ── Banner Hero ── */}
        <div className="event-detail-hero relative">
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${bannerImage})` }} />
          <div className="event-detail-hero-overlay absolute inset-0" />
          <div className="event-detail-hero-inner relative z-10 mx-auto px-8 pt-24 pb-14">
            <button onClick={() => navigate("/")}
              className="event-detail-back flex items-center gap-2 text-sm mb-6 px-4 py-2 text-white/80 hover:text-white transition-colors">
              <ArrowLeft className="h-4 w-4" /> Back to events
            </button>
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              <p className="event-detail-kicker text-xs font-bold uppercase tracking-widest mb-3">
                {event.venue}
              </p>
              <div className="flex items-start gap-3 mb-3 flex-wrap">
                <h1 className="event-detail-title font-bold text-3xl md:text-4xl text-white">{event.name}</h1>
                <StatusBadge status={status} />
              </div>
              <p className="event-detail-description text-white/80 text-base">{event.description}</p>
            </motion.div>
          </div>
        </div>

        <div className="event-detail-body mx-auto py-12 px-8">

          {/* ── Section 1: Event Info ── */}
          <div id="event-info" className="event-detail-info-grid section-anchor grid md:grid-cols-2 gap-10 mb-12">

            <div className="event-detail-panel space-y-5">
              <h2 className="event-detail-section-heading font-bold text-xl mb-6">Event Information</h2>
              <InfoRow icon={Calendar} label="Event Dates" value={`${formatDate(event.eventStartDate)} – ${formatDate(event.eventEndDate)}`} />
              <InfoRow icon={MapPin} label="Venue" value={`${event.venue}, ${event.venueAddress}`} />
              <InfoRow icon={Users} label="Max Participants" value={String(event.maxParticipants)} />
              <InfoRow icon={Calendar} label="Registration Period" value={`${formatDate(event.openDate)} – ${formatDate(event.closeDate)}`} />
              {event.sponsorInfo && (
                <div className="flex items-start gap-3">
                  <Trophy className="h-5 w-5 mt-0.5 opacity-60 flex-shrink-0" style={{ color: "var(--color-primary)" }} />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-50">Sponsored By</p>
                    <p className="text-sm mt-0.5">{event.sponsorInfo}</p>
                  </div>
                </div>
              )}
            </div>
            <div id="event-documents" className="event-detail-panel event-detail-documents section-anchor flex flex-col gap-4">
             {event.documents && event.documents.length > 0 && (
                <div className="flex flex-col gap-4">
                    <h2 className="event-detail-section-heading font-bold text-xl mb-6">Event Documents</h2>

                      {event.documents
                        .slice()
                        .sort((a, b) => a.displayOrder - b.displayOrder)
                        .map(doc => (
                          <a
                            key={doc.id}
                            href={assetUrl(doc.fileUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="event-detail-document-link"
                          >
                            <span className="event-detail-document-icon">
                              <Download className="h-5 w-5" />
                            </span>
                            <span className="event-detail-document-copy">
                              <span>{doc.label}</span>
                              <small>Open tournament document</small>
                            </span>
                            <span className="event-detail-document-action">View</span>
                          </a>
                        ))}
                </div>
              )}
              {status === "upcoming" && (
                <div className="p-4 text-sm" style={{ backgroundColor: "var(--badge-soon-bg)", color: "var(--badge-soon-text)" }}>
                  Registration opens on {formatDate(event.openDate)}
                </div>
              )}
              {status === "closed" && (
                <div className="p-4 text-sm" style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>Registration Closed</div>
              )}
            </div>
          </div>

          {/* Google Maps embed */}
          {event.venueAddress && (
            <div className="event-detail-map mb-12 overflow-hidden">
              <iframe title="Venue Map" width="100%" height="100%" style={{ border: 0 }} loading="lazy" allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://maps.google.com/maps?q=${encodeURIComponent(event.venue + " " + event.venueAddress)}&output=embed`} />
            </div>
          )}

          {/* ── Gallery Section ── */}
   
          <div id="event-gallery" className="section-anchor">
            <EventGallery images={galleryImages} />
          </div>

          {/* ── Additional Information ── */}
          {event.additionalInfo && event.additionalInfo.trim() !== "" && event.additionalInfo !== "<p></p>" && (
            <div className="event-detail-panel mb-12">
                 <h2 className="event-detail-section-heading font-bold text-xl mb-6">Additional Information</h2>
              <div
                className="prose prose-sm max-w-none"
                style={{ color: "var(--color-body-text)" }}
                dangerouslySetInnerHTML={{ __html: event.additionalInfo }}
              />
            </div>
          )}

          {/* ── Section 2: Program Cards ── */}
          <div id="event-categories" className="section-anchor" ref={programsRef}>
          <h2 className="event-detail-section-heading font-bold text-xl mb-6">           
            {event.sportType.toLowerCase() === "badminton" ? "Event Categories" : "Programs"}
          </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            {event.programs.map((prog) => {
              const cartEntryCount = getCartEntryCount(prog.id);
              const capStatus = getProgramCapacityStatus({
                ...prog,
                currentParticipants: prog.currentParticipants + cartEntryCount,
              });
              const isFull = capStatus === "full";
              const progClosed = prog.status === "closed";
              const canRegister = status === "open" && !isFull && !progClosed;
              return (
                <div key={prog.id} className="event-detail-program-card flex flex-col"
                  style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
                  <div className="h-1" style={{ backgroundColor: "var(--color-primary)" }} />
                  <div className="p-6 flex flex-col flex-1">
                    <div className="flex items-start justify-between mb-3 gap-2">
                      <h3 className="event-category-title flex-1">{prog.name}</h3>
                      <StatusBadge status={capStatus} />
                    </div>
                    <div className="event-category-body">
                      <div className="event-category-price-block">
                        <span className="event-category-fee">
                          {prog.paymentRequired ? `${currency} $${prog.fee}` : "Free"}
                        </span>
                        {prog.paymentRequired && (
                          <p className="event-category-fee-note">
                            {prog.feeStructure === "per_player" ? "per player" : "per entry"}
                          </p>
                        )}
                      </div>
                      <div className="event-category-facts">
                        <div className="event-category-fact"><BadgeInfo className="event-category-fact-icon" /><span>{prog.type}</span></div>
                        <div className="event-category-fact"><UserRound className="event-category-fact-icon" /><span>{prog.gender}</span></div>
                        <div className="event-category-fact"><CalendarDays className="event-category-fact-icon" /><span>{prog.minAge}–{prog.maxAge} yrs</span></div>
                        <div className="event-category-fact"><Users className="event-category-fact-icon" />
                          <span>{prog.minPlayers === prog.maxPlayers ? prog.maxPlayers : `${prog.minPlayers}–${prog.maxPlayers}`} per entry</span>
                        </div>
                      </div>
                    </div>
                    <div className="event-category-action">
                      <button disabled={!canRegister} onClick={() => handleSelectProgram(prog)}
                        className="btn-primary event-category-button disabled:opacity-40 disabled:cursor-not-allowed">
                        {isFull ? (cartEntryCount > 0 ? "Limit Reached" : "Full") : progClosed ? "Closed" : "Register"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Section 3: Registration Steps ── */}
          {status === "open" && (
            <div className="event-detail-registration section-anchor" id="registration" ref={registrationRef}>
              <div className="h-px mb-12" style={{ backgroundColor: "var(--color-table-border)" }} />
              <div className="flex items-center gap-3 mb-10">
                {[{ n: 1, label: "Program" }, { n: 2, label: "Participants" }, { n: 3, label: "Cart" }].map((s) => (
                  <div key={s.n} className="flex items-center gap-3">
                    <div className="w-9 h-9 flex items-center justify-center text-sm font-bold"
                      style={{
                        backgroundColor: step >= s.n ? "var(--color-primary)" : "var(--color-table-border)",
                        color: step >= s.n ? "var(--color-hero-text)" : "var(--color-body-text)",
                      }}>{s.n}</div>
                    <span className="text-sm font-medium hidden sm:inline">{s.label}</span>
                    {s.n < 3 && <div className="w-10 h-px" style={{ backgroundColor: "var(--color-table-border)" }} />}
                  </div>
                ))}
              </div>

              <AnimatePresence mode="wait">
                {step === 1 && !selectedProgram && (
                  <motion.div key="step1" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                    <p className="text-sm opacity-60">Select a program above to begin registration.</p>
                  </motion.div>
                )}

                {step === 2 && selectedProgram && (
                  <motion.div key="step2" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-bold text-lg">{editingCartIndex !== null ? "Edit: " : ""}{selectedProgram.name} — Participant Details</h3>
                      <button onClick={() => { setStep(cart.length > 0 ? 3 : 1); setSelectedProgram(null); setEditingCartIndex(null); }}
                        className="text-sm font-medium" style={{ color: "var(--color-primary)" }}>Cancel</button>
                    </div>
                    {formError && (
                      <div className="flex items-center gap-2 p-4 mb-5 text-sm" style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
                        <AlertCircle className="h-4 w-4 flex-shrink-0" /> {formError}
                      </div>
                    )}
                    {participants.map((p, idx) => (
                      <div key={p.id} className="p-6 mb-5" style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
                        <div className="flex items-center justify-between mb-5">
                          <h4 className="font-semibold text-sm">Player {idx + 1}</h4>
                          {participants.length > selectedProgram.minPlayers && (
                            <button onClick={() => removeParticipant(idx)} className="text-xs flex items-center gap-1 opacity-60 hover:opacity-100">
                              <Trash2 className="h-3 w-3" /> Remove
                            </button>
                          )}
                        </div>
                        <ParticipantFieldsForm
                          values={p}
                          onChange={(patch) => {
                            clearParticipantErrors(idx, errorKeysForParticipantPatch(patch));
                            setParticipants((prev) =>
                              prev.map((pp, i) => i === idx ? { ...pp, ...patch } : pp)
                            );
                            // Restore suggestion trigger: fire when fullName changes
                            if (typeof patch.fullName === "string") {
                              const q = patch.fullName;
                              if (q.length >= 3) {
                                const matches = existingParticipants.filter((ep) =>
                                  ep.fullName.toLowerCase().startsWith(q.toLowerCase())
                                );
                                setSuggestions(matches.length > 0 ? { idx, matches } : null);
                              } else {
                                setSuggestions(null);
                              }
                            }
                          }}
                          programFields={selectedProgram.fields}
                          eventType={event.sportType}
                          errors={Object.fromEntries(
                            Object.entries(errors)
                              .filter(([k]) => k.startsWith(`p${idx}.`))
                              .map(([k, v]) => [k.replace(`p${idx}.`, ""), v])
                          )}
                          onFileChange={(file) =>
                            {
                              clearParticipantErrors(idx, ["documentUpload"]);
                              setParticipants((prev) =>
                                prev.map((pp, i) => i === idx ? { ...pp, documentFile: file } : pp)
                              );
                            }
                          }
                          newFile={p.documentFile ?? null}
                          sbaEnabled={true}
                          sbaStatus={sbaStatus[idx] ?? "idle"}
                          onSbaRetrieve={() => retrieveBySbaId(idx, p.sbaId || "")}
                          onSbaIdChange={(v) => {
                            clearParticipantErrors(idx, ["sbaId"]);
                            setSbaStatus((prev) => ({ ...prev, [idx]: v.trim() ? prev[idx] : "idle" }));
                          }}
                          suggestions={
                            suggestions?.idx === idx
                              ? suggestions.matches
                              : []
                          }
                          onApplySuggestion={(s) => applyAutoFill(idx, s as unknown as Participant)}
                          nationalityOptions={NATIONALITY_OPTIONS}
                        />
                      </div>
                    ))}

                    {participants.length < selectedProgram.maxPlayers && (
                      <button onClick={addParticipant} className="flex items-center gap-2 text-sm font-medium mb-8" style={{ color: "var(--color-primary)" }}>
                        <Plus className="h-4 w-4" /> Add Player
                      </button>
                    )}
                    <div className="flex gap-3">
                      <button onClick={() => { setStep(cart.length > 0 ? 3 : 1); setSelectedProgram(null); setEditingCartIndex(null); }}
                        className="btn-outline px-6 py-2.5 text-sm font-medium">Back</button>
                      <button onClick={handleAddToCart} className="btn-primary px-6 py-2.5 text-sm font-semibold">
                        {editingCartIndex !== null ? "Update Registration List" : "Add to Registration List"}
                      </button>
                    </div>
                  </motion.div>
                )}

                {step === 3 && (
                  <motion.div key="step3" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                    <div className="flex items-center gap-2 mb-6">
                      <ShoppingCart className="h-5 w-5" style={{ color: "var(--color-primary)" }} />
                      <h3 className="font-bold text-lg">Your Cart</h3>
                    </div>
                    {cart.length === 0 ? (
                      <div className="text-center py-12 opacity-60">
                        <p>Your cart is empty.</p>
                        <button onClick={() => setStep(1)} className="mt-3 text-sm font-medium" style={{ color: "var(--color-primary)" }}>Add a registration</button>
                      </div>
                    ) : (
                      <>
                        {cart.map((entry, idx) => (
                          <div key={idx} className="p-5 mb-3 flex items-start justify-between" style={{ border: "1px solid var(--color-table-border)" }}>
                            <div>
                              <p className="font-semibold">{entry.programName}</p>
                              <p className="text-sm opacity-70 mt-1">{entry.participants.map((p) => p.fullName).join(", ")}</p>
                              {entry.feeStructure === "per_player" && entry.feePerPlayer != null && (
                                <p className="text-xs opacity-50 mt-0.5">
                                  {entry.participants.length} player{entry.participants.length !== 1 ? "s" : ""} × {currency} ${entry.feePerPlayer.toFixed(2)}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                              <span className="font-bold" style={{ color: "var(--color-primary)" }}>{currency} ${entry.fee.toFixed(2)}</span>
                              <button onClick={() => editCartEntry(idx)} className="p-1.5 opacity-50 hover:opacity-100" title="Edit"><Edit2 className="h-4 w-4" /></button>
                              <button onClick={() => removeCartEntry(idx)} className="p-1.5 opacity-50 hover:opacity-100" title="Remove"><Trash2 className="h-4 w-4" /></button>
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center justify-between py-5" style={{ borderTop: "1px solid var(--color-table-border)" }}>
                          <span className="font-bold text-lg">Total</span>
                          <span className="font-bold text-xl" style={{ color: "var(--color-primary)" }}>{currency} ${totalPrice.toFixed(2)}</span>
                        </div>
                        {/* Session restored banner — shown when user returns after payment cancel */}
                        {/* Contact person — receipt will be sent here */}
                        {!isAdminPaymentBypass && (
                        <div className="event-detail-panel p-5 mb-5" style={{ border: "1px solid var(--color-table-border)" }}>
                          <p className="text-xs font-semibold mb-4 opacity-60">CONTACT PERSON</p>
                          <p className="text-xs opacity-50 mb-4">The registration receipt will be emailed to this address.</p>
                          <div className="grid sm:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-xs font-medium mb-1">
                                Full Name <span style={{ color: "var(--badge-open-text)" }}>*</span>
                              </label>
                              <input
                                className="field-input"
                                placeholder="Name of person registering"
                                value={contact.name}
                                onChange={e => { setContact(c => ({ ...c, name: e.target.value })); setContactErrors(ce => ({ ...ce, name: undefined })); }}
                              />
                              {contactErrors.name && <p className="text-xs mt-1" style={{ color: "var(--badge-open-text)" }}>{contactErrors.name}</p>}
                            </div>
                            <div>
                              <label className="block text-xs font-medium mb-1">
                                Email <span style={{ color: "var(--badge-open-text)" }}>*</span>
                              </label>
                              <input
                                className="field-input"
                                type="email"
                                placeholder="receipt@email.com"
                                value={contact.email}
                                onChange={e => { setContact(c => ({ ...c, email: e.target.value })); setContactErrors(ce => ({ ...ce, email: undefined })); }}
                              />
                              {contactErrors.email && <p className="text-xs mt-1" style={{ color: "var(--badge-open-text)" }}>{contactErrors.email}</p>}
                            </div>
                            <div>
                              <label className="block text-xs font-medium mb-1">
                                Phone <span style={{ color: "var(--badge-open-text)" }}>*</span>
                              </label>
                              <input
                                className="field-input"
                                placeholder="+65 9123 4567"
                                value={contact.phone}
                                onChange={e => { setContact(c => ({ ...c, phone: e.target.value })); setContactErrors(ce => ({ ...ce, phone: undefined })); }}
                              />
                              {contactErrors.phone && <p className="text-xs mt-1" style={{ color: "var(--badge-open-text)" }}>{contactErrors.phone}</p>}
                            </div>
                          </div>
                        </div>
                        )}

                        {/* Payment method selector — only shown when payment is required */}
                        {cartRequiresPayment && !isAdminPaymentBypass && (
                          <div className="event-detail-panel mb-5 p-5" style={{ border: "1px solid var(--color-table-border)" }}>
                            <p className="text-xs font-semibold mb-3 opacity-60">Payment Method</p>
                            <div className="flex gap-3">
                              {([
                                { value: "card",   label: "Credit / Debit Card", sub: "Visa, Mastercard, Amex" },
                                { value: "paynow", label: "PayNow",              sub: "Instant bank transfer" },
                              ] as const).map(opt => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => setPaymentMethod(opt.value)}
                                  className="event-detail-choice-card flex-1 p-4 text-left transition-all"
                                  style={{
                                    border: `2px solid ${paymentMethod === opt.value ? "var(--color-primary)" : "var(--color-table-border)"}`,
                                    backgroundColor: paymentMethod === opt.value ? "var(--color-row-hover)" : "transparent",
                                  }}>
                                  <p className="text-sm font-semibold">{opt.label}</p>
                                  <p className="text-xs opacity-50 mt-0.5">{opt.sub}</p>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {!isAdminPaymentBypass && (
                        <div className="event-detail-panel p-5 mb-5" style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
                          <label className="flex items-start justify-between gap-4 cursor-pointer text-sm leading-relaxed">
                            <span style={{ color: "var(--color-body-text)" }}>{cfg.consentText}</span>
                            <Switch checked={consentChecked} onCheckedChange={setConsentChecked} />
                          </label>
                        </div>
                        )}
                        {submitError && (
                          <div className="flex items-center gap-2 p-3 mb-3 text-sm"
                            style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
                            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {submitError}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-3">
                          <button onClick={scrollToPrograms} className="btn-outline px-6 py-2.5 text-sm font-medium">Add More</button>
                          <button
                            disabled={!canSubmitCart || submitting}
                            onClick={handleCheckout}
                            className="btn-primary px-8 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                            {submitting
                              ? "Processing…"
                              : isAuthenticated
                              ? "Confirm Registration"
                              : cartRequiresPayment ? "Proceed to Payment" : "Confirm Registration"}
                          </button>
                        </div>
                        {isAuthenticated && <p className="text-xs mt-3 opacity-60">As admin, registration will be confirmed directly. You can set payment status in the next step.</p>}
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </main>

      <EmbeddedPaymentModal
        open={paymentModalOpen}
        attempt={paymentAttempt}
        paymentMethod={paymentMethod}
        summaryItems={buildPaymentSummaryItems()}
        onClose={() => {
          setPaymentModalOpen(false);
          setPaymentAttempt(null);
        }}
        onConfirmed={handlePaymentConfirmed}
      />

      {/* ── Admin Registration Confirmation Modal ── */}
      <Dialog open={adminConfirmOpen} onOpenChange={v => { if (!v) { setAdminConfirmOpen(false); setAdminConfirmNote(""); setAdminConfirmRef(""); } }}>
        <DialogContent className="max-w-md p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-8 pb-0">
            <DialogTitle className="font-bold text-xl">Confirm Registration</DialogTitle>
          </DialogHeader>
          <div className="p-8 pt-4 space-y-4">
            <div className="p-3 text-sm" style={{ backgroundColor: "var(--badge-soon-bg)", color: "var(--badge-soon-text)" }}>
              Admin registration — Payment will be bypassed. Select the payment outcome below.
            </div>
            <div>
              <label className="block text-xs font-semibold mb-2 opacity-70">Payment Status *</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: "S",  label: "Paid",              sub: "Collected now" },
                  { value: "W",  label: "Waived",            sub: "Fee waived" },
                  { value: "PC", label: "Pending Collection",sub: "Will pay later" },
                ] as const).map(opt => (
                  <button key={opt.value} type="button"
                    onClick={() => setAdminConfirmStatus(opt.value)}
                    className="p-3 text-left text-xs transition-all"
                    style={{
                      border: `2px solid ${adminConfirmStatus === opt.value ? "var(--color-primary)" : "var(--color-table-border)"}`,
                      backgroundColor: adminConfirmStatus === opt.value ? "var(--color-row-hover)" : "transparent",
                    }}>
                    <p className="font-semibold">{opt.label}</p>
                    <p className="opacity-50 mt-0.5">{opt.sub}</p>
                  </button>
                ))}
              </div>
            </div>
            {showAdminPaymentDetails && (
              <div>
                <label className="block text-xs font-semibold mb-2 opacity-70">Payment Method</label>
                <select className="field-input" value={adminConfirmMethod}
                  onChange={e => setAdminConfirmMethod(e.target.value)}>
                  <option value="Cash">Cash</option>
                  <option value="BankTransfer">Bank Transfer</option>
                  <option value="PayNow">PayNow</option>
                  <option value="Others">Others</option>
                </select>
              </div>
            )}
            {showAdminPaymentDetails && (
              <div>
                <label className="block text-xs font-semibold mb-2 opacity-70">Payment Reference <span className="opacity-40">(optional)</span></label>
                <input className="field-input" value={adminConfirmRef}
                  onChange={e => setAdminConfirmRef(e.target.value)}
                  placeholder="e.g. PayNow ref, receipt number" />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold mb-2 opacity-70">Admin Remark *</label>
              <textarea className="field-input" rows={2} value={adminConfirmNote}
                onChange={e => setAdminConfirmNote(e.target.value)}
                placeholder="e.g. Walk-in at counter, cash collected by John" />
            </div>
          </div>
          <div className="p-8 pt-0 flex gap-3 justify-end">
            <button onClick={() => { setAdminConfirmOpen(false); setAdminConfirmNote(""); setAdminConfirmRef(""); }}
              className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
            <button
              disabled={!adminConfirmNote.trim() || submitting}
              className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
              onClick={async () => {
                if (!event || !adminConfirmNote.trim()) return;
                setSubmitting(true);
                try {
                  // 1. Write registration to DB
                  const docUploads2: Promise<void>[] = [];
                  const docMap2: Record<string, string> = {};
                  cart.forEach((entry, ei) => {
                    entry.participants.forEach((p, pi) => {
                      if (p.documentFile) {
                        docUploads2.push(
                          apiUploadFile(p.documentFile, "registrations/documents").then(r => {
                            if (r.data) docMap2[`${ei}-${pi}`] = r.data;
                          })
                        );
                      }
                    });
                  });
                  if (docUploads2.length) await Promise.all(docUploads2);
                  const payload2 = buildRegistrationPayload(docMap2);
                  const regResult = await apiCreateRegistration(payload2);
                  if (regResult.error) { setSubmitError(regResult.error.message); setAdminConfirmOpen(false); return; }
                  // 2. Confirm with chosen payment status
                  const confirmResult = await apiConfirmRegistration(regResult.data!.id, {
                    paymentStatus: adminConfirmStatus,
                    method: showAdminPaymentDetails ? adminConfirmMethod : undefined,
                    paymentReference: showAdminPaymentDetails ? adminConfirmRef || undefined : undefined,
                    adminNote: adminConfirmNote,
                  });
                  if (confirmResult.error) { setSubmitError(confirmResult.error.message); setAdminConfirmOpen(false); return; }
                  clearSession();
                  setAdminConfirmOpen(false);
                  navigate(`/payment/result?status=success&reg=${regResult.data!.id}&direct=admin`, {
                    state: { directRegistration: confirmResult.data, directMode: "admin" },
                  });
                } finally {
                  setSubmitting(false);
                }
              }}>
              {submitting ? "Processing…" : "Confirm Registration"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="h-5 w-5 mt-0.5 opacity-60" style={{ color: "var(--color-primary)" }} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-50">{label}</p>
        <p className="text-sm mt-0.5">{value}</p>
      </div>
    </div>
  );
}

// Field component replaced by FieldWrapper from ParticipantFieldsForm
