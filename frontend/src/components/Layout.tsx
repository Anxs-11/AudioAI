import { useNavigate, useLocation } from "react-router-dom";
import { logout } from "../api";

const NAV_ITEMS = [
  { path: "/upload", label: "New Batch", icon: "⬆" },
  { path: "/history", label: "History", icon: "📋" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="min-h-screen flex bg-[#111827]">
      {/* Sidebar */}
      <aside className="w-52 bg-[#0f1623] text-white flex flex-col shrink-0">
        <div
          className="px-4 py-5 flex items-center gap-2.5 cursor-pointer border-b border-white/[0.08]"
          onClick={() => navigate("/upload")}
        >
          <div className="w-7 h-7 bg-[#2a78d6] rounded-md flex items-center justify-center">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M2 12h4l3-9 4 18 3-9h4" />
            </svg>
          </div>
          <span className="text-sm font-medium">AutoAce</span>
        </div>

        <nav className="flex-1 py-2.5 px-2">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] mb-0.5 transition ${
                  active
                    ? "bg-[#2a78d6]/20 text-[#7bb3f0]"
                    : "text-white/50 hover:bg-white/[0.06] hover:text-white/80"
                }`}
              >
                <span className="text-[15px]">{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/[0.08] p-2.5">
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-white/[0.35] hover:text-red-400 transition"
          >
            <span className="text-[15px]">🚪</span> Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
