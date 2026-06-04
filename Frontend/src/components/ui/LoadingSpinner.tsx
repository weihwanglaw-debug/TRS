import { motion } from "framer-motion";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

export default function LoadingSpinner({ size = "md", label }: LoadingSpinnerProps) {
  const dims = { sm: "h-5 w-5", md: "h-8 w-8", lg: "h-12 w-12" };
  const borderW = { sm: "2px", md: "3px", lg: "4px" };

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <motion.div
        className={`${dims[size]} rounded-full`}
        style={{
          border: `${borderW[size]} solid var(--color-table-border)`,
          borderTopColor: "var(--color-primary)",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
      />
      {label && (
        <p className="text-sm opacity-60" style={{ color: "var(--color-body-text)" }}>
          {label}
        </p>
      )}
    </div>
  );
}

export function PageLoader({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <LoadingSpinner size="lg" label={label} />
    </div>
  );
}

export function ButtonLoader() {
  return (
    <motion.div
      className="h-4 w-4 rounded-full"
      style={{
        border: "2px solid rgba(255,255,255,0.3)",
        borderTopColor: "var(--color-hero-text)",
      }}
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
    />
  );
}
