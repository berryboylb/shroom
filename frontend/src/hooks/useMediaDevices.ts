import { useState, useEffect } from 'react';
import { getDevices, requestPermissions, type DeviceState } from '../lib/media';

export function useMediaDevices() {
  const [devices, setDevices] = useState<DeviceState>({
    audioInputs: [],
    videoInputs: [],
    audioOutputs: [],
  });
  const [hasPermissions, setHasPermissions] = useState<boolean | null>(null);

  useEffect(() => {
    async function init() {
      const granted = await requestPermissions();
      setHasPermissions(granted);
      
      if (granted) {
        const devs = await getDevices();
        setDevices(devs);
      }
    }
    
    init();
    
    const handleDeviceChange = async () => {
      if (hasPermissions) {
        setDevices(await getDevices());
      }
    };
    
    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [hasPermissions]);

  return { devices, hasPermissions };
}
