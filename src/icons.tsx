import {
  Archive, Baby, Banknote, Bell, BookOpen, Briefcase, CalendarClock, CalendarDays, Camera, Car, Code, Coffee, Coins, DollarSign, Dumbbell, Flag, Folder, Gift,
  GraduationCap, Heart, House, Inbox, Leaf, Lightbulb, Music, Palette, Plane, Rocket, ShoppingCart, Star, Sun, Target,
  Users, Wallet, Zap, type LucideIcon,
} from "lucide-react";

// Набор иконок для пунктов меню и проектов. В базе храним имя, чтобы набор можно было расширять
export const ICONS: Record<string, LucideIcon> = {
  inbox: Inbox, sun: Sun, calendar: CalendarDays, archive: Archive, folder: Folder, briefcase: Briefcase,
  users: Users, house: House, star: Star, heart: Heart, book: BookOpen, code: Code, flag: Flag, target: Target,
  rocket: Rocket, coffee: Coffee, dumbbell: Dumbbell, music: Music, plane: Plane, cart: ShoppingCart,
  wallet: Wallet, study: GraduationCap, idea: Lightbulb, bell: Bell, zap: Zap, leaf: Leaf, car: Car, baby: Baby,
  camera: Camera, gift: Gift, palette: Palette, schedule: CalendarClock,
  money: Banknote, dollar: DollarSign, coins: Coins,
};

export function Icon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  const C = ICONS[name] ?? Folder;
  return <C size={size} strokeWidth={2.2} color={color} aria-hidden="true" />;
}
