import { APPS } from "./apps";
import { MENU_HEIGHT, OwnWindowProvider, useWindows } from "./WindowManager";
import Window from "./Window";
import Dock from "./Dock";
import MenuBar from "./MenuBar";
import FloatingNotes from "../components/Notes/FloatingNotes";

/**
 * The Aqua desktop: menu bar, the open windows, the Dock and floating notes.
 * Windows render in a fixed order (stacking is done with z-index) so focusing a
 * window never remounts its page - minimised windows stay mounted too, so timers
 * and editors keep their state.
 */
export default function Desktop() {
  const { state, front } = useWindows();

  return (
    <div className="aqua-desktop fixed inset-0">
      <MenuBar />
      <main className="absolute inset-x-0 bottom-0" style={{ top: MENU_HEIGHT }}>
        {APPS.map((app) => {
          const win = state.windows[app.id];
          if (!win?.open) return null;
          const active = front === app.id;
          return (
            <Window key={app.id} app={app} win={win} active={active} z={10 + state.order.indexOf(app.id)}>
              <OwnWindowProvider value={{ id: app.id, active, path: win.path }}>
                <app.Component />
              </OwnWindowProvider>
            </Window>
          );
        })}
      </main>
      <Dock />
      <FloatingNotes />
    </div>
  );
}
