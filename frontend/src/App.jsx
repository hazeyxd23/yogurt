import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "./context/ToastContext";
import { ThemeProvider } from "./context/ThemeContext";
import { NotesProvider } from "./context/NotesContext";
import { WindowManager } from "./desktop/WindowManager";
import Desktop from "./desktop/Desktop";

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
      <NotesProvider>
        <BrowserRouter>
          <WindowManager>
            <Desktop />
          </WindowManager>
        </BrowserRouter>
      </NotesProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
