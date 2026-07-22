import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useLiveConfig } from "@/contexts/LiveConfigContext";

const effectiveDate = "22 July 2026";

const sections = [
  {
    title: "Using The Registration System",
    body: [
      "This system is provided for event registration and administration by or for Wyse Active. Users must provide accurate, complete, and current information when submitting a registration.",
      "The person submitting a registration is responsible for ensuring that the participant details, programme selections, contact information, and payment information are correct.",
    ],
  },
  {
    title: "Eligibility And Programme Requirements",
    body: [
      "Each event or programme may have its own eligibility rules, including age, gender, participant count, SBA ranking or ID requirements, team or club information, and other event-specific conditions.",
      "Wyse Active may reject, amend, or cancel a registration if the participant does not meet the applicable requirements or if the submitted information is incorrect or incomplete.",
    ],
  },
  {
    title: "Payment",
    body: [
      "Available payment methods may include Stripe card payment, PayNow, bank transfer, cash collection, waived fees, or pending collection, depending on the event and organiser setup.",
      "A registration is treated according to the payment status recorded in the system. Admin-marked payment statuses are used for offline or organiser-assisted payment handling.",
    ],
  },
  {
    title: "Refunds And Cancellations",
    body: [
      "Wyse Active may allow full or partial refunds where appropriate. Refund decisions, cancellation handling, and processing arrangements are subject to the event rules and organiser approval.",
      "Where a registration, entry, or participant is cancelled, updated registration details and refund information may be issued to the registered contact email.",
    ],
  },
  {
    title: "Event Changes",
    body: [
      "Wyse Active may change event details, programme availability, fixtures, schedules, venues, registration windows, or other operational details where necessary.",
      "If an event is postponed, changed, or cancelled, Wyse Active will determine the appropriate handling of affected registrations and payments.",
    ],
  },
  {
    title: "User Conduct",
    body: [
      "Users must not misuse the system, submit false information, interfere with the service, attempt unauthorised access, or use the system for purposes unrelated to legitimate event registration or communication.",
    ],
  },
  {
    title: "Limitation Of Liability",
    body: [
      "To the fullest extent permitted by law, Wyse Active is not liable for indirect, incidental, special, consequential, or punitive losses arising from use of the registration system, event participation, event changes, cancellation, or inability to access the system.",
      "Nothing in these terms excludes liability that cannot be excluded under applicable law.",
    ],
  },
  {
    title: "Updates To These Terms",
    body: [
      "Wyse Active may update these terms from time to time. The version shown on this page applies from the effective date stated above.",
    ],
  },
];

export default function TermsOfService() {
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
                  Terms Of Service
                </h1>
                <p className="mt-3 text-sm opacity-60">Effective date: {effectiveDate}</p>
              </div>
              <Link to="/" className="landing-button secondary">
                <Home className="h-4 w-4" /> Back to Home
              </Link>
            </div>

            <div className="space-y-8 text-sm leading-7" style={{ color: "var(--color-body-text)" }}>
              <section>
                <h2 className="landing-display text-xl font-bold uppercase">Who These Terms Apply To</h2>
                <p className="mt-3 opacity-80">
                  These terms apply to use of this registration system for Wyse Active events and activities.
                  The system is operated for Wyse Active by Wyse Active Pte Ltd, located at
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
                  For questions about these terms, please contact Wyse Active at{" "}
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
