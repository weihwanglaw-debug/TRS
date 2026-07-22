import { useState } from "react";
import type { FormEvent } from "react";
import { motion } from "framer-motion";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import { apiSendLandingMessage } from "@/lib/api";

const DEFAULT_MESSAGE_TITLE = "Questions before joining?";
const DEFAULT_MESSAGE_BODY =
  "Players, parents, coaches, and club representatives can leave a message for the tournament team.\nUse this space for event questions, program clarification, venue help, or registration support.";

function newCaptcha() {
  return {
    a: Math.floor(Math.random() * 9) + 2,
    b: Math.floor(Math.random() * 9) + 2,
  };
}

export default function MessageSection() {
  const { cfg } = useLiveConfig();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [captcha, setCaptcha] = useState(newCaptcha);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const messageTitle = cfg.messageTitle?.trim() || DEFAULT_MESSAGE_TITLE;
  const messageBody = cfg.messageBody?.trim() || DEFAULT_MESSAGE_BODY;

  const clearForm = () => {
    setName("");
    setContact("");
    setTopic("");
    setMessage("");
    setCaptcha(newCaptcha());
    setCaptchaAnswer("");
    setWebsite("");
    setStatus(null);
  };

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    if (!name.trim() || !contact.trim() || !topic.trim() || !message.trim()) {
      setStatus({ type: "error", text: "Please complete all fields before sending." });
      return;
    }

    const parsedCaptcha = Number.parseInt(captchaAnswer.trim(), 10);
    if (!Number.isInteger(parsedCaptcha) || parsedCaptcha !== captcha.a + captcha.b) {
      setStatus({ type: "error", text: "Please answer the verification question correctly." });
      setCaptcha(newCaptcha());
      setCaptchaAnswer("");
      return;
    }

    setSending(true);
    try {
      const result = await apiSendLandingMessage({
        name: name.trim(),
        contact: contact.trim(),
        topic: topic.trim(),
        message: message.trim(),
        captchaA: captcha.a,
        captchaB: captcha.b,
        captchaAnswer: parsedCaptcha,
        website: website.trim(),
      });

      if (result.error) {
        setStatus({ type: "error", text: result.error.message });
        setCaptcha(newCaptcha());
        setCaptchaAnswer("");
        return;
      }

      setStatus({ type: "success", text: "Message sent. The tournament team will follow up with you." });
      setName("");
      setContact("");
      setTopic("");
      setMessage("");
      setCaptcha(newCaptcha());
      setCaptchaAnswer("");
      setWebsite("");
    } catch {
      setStatus({ type: "error", text: "Message could not be sent. Please try again later." });
      setCaptcha(newCaptcha());
      setCaptchaAnswer("");
    } finally {
      setSending(false);
    }
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
            {messageTitle}
          </h2>
          <p style={{ whiteSpace: "pre-line" }}>
            {messageBody}
          </p>       
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
              />
            </div>
            <div className="trs-field">
              <label htmlFor="landing-message-contact">Email or phone</label>
              <input
                id="landing-message-contact"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
              />
            </div>
            <div className="trs-field">
              <label htmlFor="landing-message-topic">Subject</label>
              <input
                id="landing-message-topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              />
            </div>
            <div className="trs-field">
              <label htmlFor="landing-message-body">Message</label>
              <textarea
                id="landing-message-body"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
            <div className="trs-field" aria-hidden="true" style={{ display: "none" }}>
              <label htmlFor="landing-message-website">Website</label>
              <input
                id="landing-message-website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </div>
            <div className="trs-field">
              <label htmlFor="landing-message-captcha">Verification: {captcha.a} + {captcha.b}</label>
              <input
                id="landing-message-captcha"
                inputMode="numeric"
                value={captchaAnswer}
                onChange={(event) => setCaptchaAnswer(event.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="landing-button" type="submit" disabled={sending}>
              {sending ? "Sending..." : "Send Message"}
            </button>
            <button className="landing-button secondary" type="button" onClick={clearForm} disabled={sending}>
              Clear
            </button>
          </div>
          {status && (
            <p
              className="mt-4 text-sm font-semibold"
              style={{ color: status.type === "success" ? "var(--feedback-success)" : "var(--feedback-error)" }}
            >
              {status.text}
            </p>
          )}
        </motion.form>
      </div>
    </section>
  );
}
