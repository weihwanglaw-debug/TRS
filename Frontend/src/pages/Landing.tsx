import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import HeroSection from "@/components/landing/HeroSection";
import EventCarousel from "@/components/landing/EventCarousel";
import AdvertiseSection from "@/components/landing/AdvertiseSection";

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <EventCarousel />
        <AdvertiseSection />
      </main>
      <Footer />
    </div>
  );
}
