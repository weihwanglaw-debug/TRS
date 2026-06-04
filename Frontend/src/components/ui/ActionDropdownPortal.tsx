import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Placement = {
  left: number;
  top: number;
  translateX: string;
  translateY: string;
};

export default function ActionDropdownPortal({
  open,
  anchorEl,
  onClose,
  className = "action-dropdown",
  children,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const computePlacement = useCallback(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const menu = menuRef.current;
    const menuW = menu?.offsetWidth ?? 0;
    const menuH = menu?.offsetHeight ?? 0;

    const margin = 8;
    const baseLeft = Math.min(rect.right, window.innerWidth - margin);
    const baseTop = rect.bottom + 4;

    let left = baseLeft;
    let top = baseTop;
    let translateX = "-100%";
    let translateY = "0";

    if (menuW > 0) {
      const leftEdge = left - menuW;
      if (leftEdge < margin) left = Math.max(rect.left + menuW, margin + menuW);
    }

    if (menuH > 0) {
      const bottomEdge = top + menuH;
      if (bottomEdge > window.innerHeight - margin) {
        top = rect.top - 4;
        translateY = "-100%";
      }
    }

    setPlacement({ left, top, translateX, translateY });
  }, [anchorEl]);

  useLayoutEffect(() => {
    if (!open) return;
    setPlacement(null);
    computePlacement();
    const raf = window.requestAnimationFrame(computePlacement);
    return () => window.cancelAnimationFrame(raf);
  }, [open, anchorEl, computePlacement]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onClose();
    };

    const onReflow = () => computePlacement();

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, anchorEl, onClose, computePlacement]);

  if (!open || !anchorEl) return null;

  const body = typeof document !== "undefined" ? document.body : null;
  if (!body) return null;

  const style = placement
    ? ({
        position: "fixed",
        left: placement.left,
        top: placement.top,
        transform: `translate(${placement.translateX}, ${placement.translateY})`,
        zIndex: 1000,
      } as const)
    : ({
        position: "fixed",
        left: -9999,
        top: -9999,
        zIndex: 1000,
      } as const);

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      style={{ ...style, visibility: placement ? "visible" : "hidden" }}
      role="menu"
    >
      {children}
    </div>,
    body,
  );
}
