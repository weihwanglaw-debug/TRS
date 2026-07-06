import { useState } from "react";
import type { FormEvent } from "react";
import { motion } from "framer-motion";
import { useLiveConfig } from "@/contexts/LiveConfigContext";

const TOPICS = [
  "Registration support",
  "Program eligibility",
  "Partner venue booking",
  "General question",
];

export default function MessageSection() {
  const { cfg } = useLiveConfig();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState("");

  const clearForm = () => {
    setName("");
    setContact("");
    setTopic(TOPICS[0]);
    setMessage("");
  };

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const subject = encodeURIComponent(`[TRS] ${topic}`);
    const body = encodeURIComponent(
      [
        `Name: ${name}`,
        `Email or phone: ${contact}`,
        `Topic: ${topic}`,
        "",
        message,
      ].join("\n"),
    );
    const recipient = cfg.contactEmail || "tournaments@sba.org.sg";
    window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
  };

  return (
    <section className="landing-section warm section-anchor" id="register">
      <div className="landing-section-inner trs-message-grid">
        <motion.div
          className="trs-message-copy"
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
        >
          <p className="landing-section-label" style={{ textAlign: "left" }}>
            Leave a message /
          </p>
          <h2 className="landing-section-title" style={{ marginLeft: 0, textAlign: "left" }}>
            Questions before joining?
          </h2>
          <p>
            Players, parents, coaches, and club representatives can leave a message for the tournament team.
            Use this space for event questions, program clarification, venue help, or registration support.
          </p>
          <a className="landing-button" href="#events-section">
            View Events
          </a>
        </motion.div>

        <motion.form
          className="trs-message-form"
          onSubmit={submitMessage}
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ delay: 0.1 }}
        >
          <h3>Contact The Team</h3>
          <div className="grid gap-4">
            <div className="trs-field">
              <label htmlFor="landing-message-name">Name</label>
              <input
                id="landing-message-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="trs-field">
              <label htmlFor="landing-message-contact">Email or phone</label>
              <input
                id="landing-message-contact"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder="alex@example.com"
              />
            </div>
            <div className="trs-field">
              <label htmlFor="landing-message-topic">Topic</label>
              <select
                id="landing-message-topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              >
                {TOPICS.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="trs-field">
              <label htmlFor="landing-message-body">Message</label>
              <textarea
                id="landing-message-body"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="I would like to check which program is suitable before registering."
              />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="landing-button" type="submit">
              Send Message
            </button>
            <button className="landing-button secondary" type="button" onClick={clearForm}>
              Clear
            </button>
          </div>
        </motion.form>
      </div>
    </section>
  );
}
