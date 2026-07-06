import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import HeroSection from "@/components/landing/HeroSection";
import EventCarousel from "@/components/landing/EventCarousel";
import AdvertiseSection from "@/components/landing/AdvertiseSection";
import MessageSection from "@/components/landing/MessageSection";

export default function Landing() {
  return (
    <div className="landing-shell min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <EventCarousel />
        <AdvertiseSection />
        <MessageSection />
      </main>
      <Footer />
    </div>
  );
}
