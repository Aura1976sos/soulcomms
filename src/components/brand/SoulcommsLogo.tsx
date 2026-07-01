import { cn } from "@/lib/utils";

const LOGO_URL = "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100066245/b18e8d3f-ffb1-4a.png";

interface SoulcommsLogoProps {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const heights = {
  xs: "h-5",
  sm: "h-7",
  md: "h-9",
  lg: "h-12",
  xl: "h-16",
};

export const SoulcommsLogo = ({ size = "md", className }: SoulcommsLogoProps) => {
  return (
    <img
      src={LOGO_URL}
      alt="Soulcomms"
      crossOrigin="anonymous"
      className={cn("w-auto object-contain", heights[size], className)}
      draggable={false}
    />
  );
};
