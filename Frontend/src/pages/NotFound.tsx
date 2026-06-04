import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: "var(--color-page-bg)" }}>
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold font-heading">404</h1>
        <p className="mb-6 text-xl" style={{ color: "var(--color-body-text)" }}>Page not found</p>
        <a href="/" className="btn-primary px-6 py-2.5 text-sm font-semibold inline-block">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
