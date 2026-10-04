import SectionTabs from "@/components/section-tabs";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div><SectionTabs group="treasury" />{children}</div>;
}
