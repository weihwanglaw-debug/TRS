import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useLiveConfig } from "@/contexts/LiveConfigContext";

const effectiveDate = "22 July 2026";

const sections = [
  {
    title: "Information We Collect",
    body: [
      "We collect information needed to manage event registrations, including participant name, date of birth, gender, email, phone number, nationality, club, team or school, SBA ID where applicable, T-shirt size, guardian information where required, registration selections, payment status, refund or cancellation records, and event-specific custom fields.",
      "Event gallery images and event information are uploaded by authorised administrators. Participant document uploads are not part of the current registration process.",
    ],
  },
  {
    title: "How We Use Information",
    body: [
      "We use registration information to process entries, validate eligibility, manage programme capacity, prepare fixtures or participant lists, issue receipts and registration details, handle refunds or cancellations, support organiser reports, and communicate about the event.",
      "For badminton events, SBA ID and related participant details may be checked against ranking or master data for validation and seeding-related administration.",
    ],
  },
  {
    title: "Payments",
    body: [
      "Payments may be handled through Stripe, PayNow, bank transfer, cash collection, waived fees, or pending collection arrangements depending on the event and organiser setup.",
      "Wyse Active does not store full credit or debit card details in this system. Card payment processing is handled by the payment provider.",
    ],
  },
  {
    title: "Emails And Notifications",
    body: [
      "The system may send registration confirmations, receipts, registration details, refund notices, cancellation notices, and responses or alerts related to messages submitted through the website.",
      "We do not use registration information for marketing emails by default.",
    ],
  },
  {
    title: "Reports And Tournament Administration",
    body: [
      "Authorised administrators may export participant lists and related registration data for event operations, including use in tournament management software such as Tournament Software.",
      "Exported reports should be handled responsibly by authorised event personnel.",
    ],
  },
  {
    title: "Access, Correction And Deletion",
    body: [
      "Participants may contact Wyse Active to request help correcting registration information. Authorised administrators may update, delete, or anonymise records where appropriate and permitted by operational requirements.",
    ],
  },
  {
    title: "Security",
    body: [
      "We use reasonable administrative and technical controls to protect registration information. No online system can be guaranteed to be completely secure, so users should avoid submitting unnecessary sensitive information.",
    ],
  },
];

export default function PrivacyPolicy() {
  const { cfg } = useLiveConfig();
  const contactEmail = cfg.contactEmail || "info@wyseactive.com";

  return (
    <div className="landing-shell min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <section className="landing-section white section-anchor">
          <div className="landing-section-inner max-w-4xl">
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="landing-section-label" style={{ textAlign: "left" }}>Legal /</p>
                <h1 className="landing-section-title" style={{ marginLeft: 0, textAlign: "left" }}>
                  Privacy Policy
                </h1>
                <p className="mt-3 text-sm opacity-60">Effective date: {effectiveDate}</p>
              </div>
              <Link to="/" className="landing-button secondary">
                <Home className="h-4 w-4" /> Back to Home
              </Link>
            </div>

            <div className="space-y-8 text-sm leading-7" style={{ color: "var(--color-body-text)" }}>
              <section>
                <h2 className="landing-display text-xl font-bold uppercase">Who We Are</h2>
                <p className="mt-3 opacity-80">
                  This registration system is operated for Wyse Active by Wyse Active Pte Ltd, located at
                  {" "}1 Venture Ave, #03-01 Perennial Business City, Singapore 608521.
                </p>
              </section>

              {sections.map(section => (
                <section key={section.title}>
                  <h2 className="landing-display text-xl font-bold uppercase">{section.title}</h2>
                  <div className="mt-3 space-y-3 opacity-80">
                    {section.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
                  </div>
                </section>
              ))}

              <section>
                <h2 className="landing-display text-xl font-bold uppercase">Contact Us</h2>
                <p className="mt-3 opacity-80">
                  For privacy questions or requests, please contact Wyse Active at{" "}
                  <a className="underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>.
                </p>
              </section>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
