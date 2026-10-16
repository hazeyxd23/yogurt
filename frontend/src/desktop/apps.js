import Dashboard from "../pages/Dashboard";
import GuitarPage from "../pages/GuitarPage";
import ReadingPage from "../pages/ReadingPage";
import LeetcodePage from "../pages/LeetcodePage";
import TasksPage from "../pages/TasksPage";
import NotesPage from "../pages/NotesPage";
import AskPage from "../pages/AskPage";
import { AskIcon, BookAppIcon, CalendarIcon, DashboardIcon, GuitarAppIcon, StickiesIcon, TerminalIcon } from "./AppIcons";

// Every section of the site is an "application" with its own window.
// `fill` apps manage their own scrolling and want the full window body.
export const APPS = [
  { id: "dashboard", title: "Dashboard", path: "/", Icon: DashboardIcon, Component: Dashboard, size: [1080, 700] },
  { id: "guitar", title: "Guitar Practice", short: "Guitar", path: "/guitar", Icon: GuitarAppIcon, Component: GuitarPage, size: [1040, 720] },
  { id: "reading", title: "Book Reading", short: "Reading", path: "/reading", Icon: BookAppIcon, Component: ReadingPage, size: [1040, 720] },
  { id: "leetcode", title: "LeetCode Daily", short: "LeetCode", path: "/leetcode", Icon: TerminalIcon, Component: LeetcodePage, size: [1000, 720] },
  { id: "tasks", title: "Calendar", path: "/tasks", Icon: CalendarIcon, Component: TasksPage, size: [1240, 760], fill: true },
  { id: "notes", title: "Notes", path: "/notes", Icon: StickiesIcon, Component: NotesPage, size: [1200, 740], fill: true },
  { id: "ask", title: "Ask", path: "/ask", Icon: AskIcon, Component: AskPage, size: [780, 700], fill: true },
];

export const appById = Object.fromEntries(APPS.map((a) => [a.id, a]));

/** Which app owns a URL ("/" is the dashboard; "/desktop" is nobody). */
export function appForPath(pathname) {
  if (pathname === "/") return "dashboard";
  return APPS.find((a) => a.path !== "/" && (pathname === a.path || pathname.startsWith(`${a.path}/`)))?.id ?? null;
}
