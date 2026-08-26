export interface DeviceState {
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
}

export async function getDevices(): Promise<DeviceState> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  
  return {
    audioInputs: devices.filter(d => d.kind === 'audioinput'),
    videoInputs: devices.filter(d => d.kind === 'videoinput'),
    audioOutputs: devices.filter(d => d.kind === 'audiooutput'),
  };
}

export async function requestPermissions(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    // Stop tracks immediately, we just wanted permission
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (err) {
    console.error("Failed to get media permissions:", err);
    return false;
  }
}
