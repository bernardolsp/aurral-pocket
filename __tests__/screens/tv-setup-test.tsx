import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useAuth } from "@/contexts/auth-context";
import { useServerHealth } from "@/hooks/auth/use-server-health";
import {
  clearTvLink,
  getPendingTvLink,
  receiveTvLink,
} from "@/lib/tv/pairing-link";
import { sendTvSetup, tvFingerprint } from "@/lib/tv/pairing";
import TvSetupScreen from "@/app/tv-setup";

jest.mock("@/contexts/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("@/hooks/auth/use-server-health", () => ({
  useServerHealth: jest.fn(),
}));
jest.mock("@/hooks/use-color-scheme", () => ({ useColorScheme: () => "dark" }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ canGoBack: () => false, replace: jest.fn() }),
}));
jest.mock("@/lib/tv/pairing", () => ({
  validTvSettings: jest.fn(() => true),
  tvFingerprint: jest.fn(() => "1234-ABCD-5678"),
  sendTvSetup: jest.fn(),
}));
const serverUrl = "https://music.example/path";
const token = "test-phone-session";
const customHeaders = { "CF-Access-Client-Secret": "fixture-secret" };
const qr = `aurralpocket://tv-pair?v=1&address=10.1.2.3&port=8123&id=${"af".repeat(16)}&key=${"A".repeat(43)}`;
const button = "Fingerprints match — send setup";

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ serverUrl, token, customHeaders });
  (useServerHealth as jest.Mock).mockReturnValue({
    data: { api: { features: ["pairing"] } },
  });
  receiveTvLink(qr);
});
afterEach(() => {
  clearTvLink(getPendingTvLink());
});

it("waits for explicit consent, describes the signed-in server and shared headers, and confirms receipt", async () => {
  (sendTvSetup as jest.Mock).mockResolvedValue(undefined);
  await render(<TvSetupScreen />);
  expect(screen.getByText("1234-ABCD-5678")).toBeTruthy();
  expect(screen.getByText("10.1.2.3:8123")).toBeTruthy();
  expect(screen.getByText(serverUrl)).toBeTruthy();
  expect(screen.getByText("CF-Access-Client-Secret")).toBeTruthy();
  expect(screen.queryByText("fixture-secret")).toBeNull();
  expect(screen.queryByText(token)).toBeNull();
  expect(sendTvSetup).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: button }));
  expect(sendTvSetup).toHaveBeenCalledWith(
    expect.objectContaining({ address: "10.1.2.3" }),
    serverUrl,
    customHeaders,
    expect.anything(),
  );
  expect(screen.getByText("Setup sent")).toBeTruthy();
});
it("cancels without contacting the server or the TV", async () => {
  await render(<TvSetupScreen />);
  await fireEvent.press(screen.getByText("Cancel"));
  expect(sendTvSetup).not.toHaveBeenCalled();
  expect(getPendingTvLink()).toBeNull();
});
it("requires a signed-in session and a pairing-capable server", async () => {
  (useAuth as jest.Mock).mockReturnValue({
    serverUrl,
    token: null,
    customHeaders,
  });
  const view = await render(<TvSetupScreen />);
  expect(screen.getByText(/Sign in to Pocket/)).toBeTruthy();
  expect(screen.queryByText(button)).toBeNull();
  (useAuth as jest.Mock).mockReturnValue({ serverUrl, token, customHeaders });
  (useServerHealth as jest.Mock).mockReturnValue({
    data: { api: { features: [] } },
  });
  await view.rerender(<TvSetupScreen />);
  expect(screen.getByText(/needs device pairing support/)).toBeTruthy();
  expect(sendTvSetup).not.toHaveBeenCalled();
});
it("aborts and requires fresh confirmation when another TV is scanned during code issuance", async () => {
  (sendTvSetup as jest.Mock).mockImplementation(
    (_link, _server, _headers, signal: AbortSignal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        }),
      ),
  );
  await render(<TvSetupScreen />);
  await fireEvent.press(screen.getByText(button));
  const signal = (sendTvSetup as jest.Mock).mock.calls[0][3] as AbortSignal;
  (tvFingerprint as jest.Mock).mockReturnValueOnce("AAAA-AAAA-AAAA");
  await act(() => receiveTvLink(qr.replace("10.1.2.3", "10.3.2.1")));
  expect(signal.aborted).toBe(true);
  expect(screen.getByText("10.3.2.1:8123")).toBeTruthy();
  expect(sendTvSetup).toHaveBeenCalledTimes(1);
});
