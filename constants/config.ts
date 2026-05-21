// Set EXPO_PUBLIC_API_URL in a .env file to override.
// Android emulator:  http://10.0.2.2:8000
// iOS simulator:     http://localhost:8000
// Physical device:   http://<your-machine-ip>:8000
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
