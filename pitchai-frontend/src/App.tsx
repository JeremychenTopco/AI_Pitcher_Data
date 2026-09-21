import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider } from "@/app/SessionContext";
import { PlayersProvider } from "@/app/PlayersStore";
import { Shell } from "@/app/Shell";
import { LoginPage, RegisterCompletePage, RegisterPage } from "@/pages/AuthPages";
import { HomePage } from "@/pages/HomePage";
import { PlayerLibraryPage } from "@/pages/PlayerLibraryPage";
import { PlayerDetailPage, SessionPage } from "@/pages/PlayerDetailPage";
import { ReportPage } from "@/pages/ReportPage";
import { ComparePage } from "@/pages/ComparePage";
import { CompareResultPage } from "@/pages/CompareResultPage";
import { SettingsPage } from "@/pages/SettingsPages";

/**
 * Route map, transcribed from the IA flowchart.
 * 檢測live is deferred and has no route yet.
 */
export default function App() {
  return (
    <SessionProvider>
      <PlayersProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/register/complete" element={<RegisterCompletePage />} />

            <Route element={<Shell />}>
              <Route index element={<HomePage />} />
              <Route path="players" element={<PlayerLibraryPage />} />
              <Route path="players/:playerId" element={<PlayerDetailPage />} />
              <Route path="sessions/:sessionId" element={<SessionPage />} />
              <Route path="report/:pitchId" element={<ReportPage />} />
              <Route path="compare" element={<ComparePage />} />
              <Route path="compare/result" element={<CompareResultPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </PlayersProvider>
    </SessionProvider>
  );
}
