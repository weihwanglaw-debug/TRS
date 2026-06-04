import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import LoginModal from "@/components/auth/LoginModal";

// /login renders the LoginModal directly.
// Authenticated users are sent straight to /admin.
export default function Login() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (isAuthenticated) navigate("/admin", { replace: true });
  }, [isAuthenticated, navigate]);

  if (isAuthenticated) return null;

  return (
    <LoginModal
      open={open}
      onClose={() => {
        setOpen(false);
        navigate("/", { replace: true });
      }}
    />
  );
}
