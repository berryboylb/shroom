import { Track, type TrackProcessor, type VideoProcessorOptions } from 'livekit-client';

/** Small color and exposure adjustment on the outgoing camera track. */
export class LightVideoEnhancement implements TrackProcessor<Track.Kind.Video> {
  name = 'shroom-light-enhancement';
  processedTrack?: MediaStreamTrack;
  private video?: HTMLVideoElement;
  private stream?: MediaStream;
  private timer?: number;

  async init(options: VideoProcessorOptions) {
    const settings = options.track.getSettings();
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(settings.width || 640, 640);
    canvas.height = Math.min(settings.height || 360, 480);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context || !canvas.captureStream) throw new Error('Video enhancement is unavailable');
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([options.track]);
    await video.play();
    this.video = video;
    context.filter = 'brightness(1.06) contrast(1.04) saturate(1.06)';
    this.timer = window.setInterval(() => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
    }, 50);
    this.stream = canvas.captureStream(20);
    this.processedTrack = this.stream.getVideoTracks()[0];
  }

  async restart(options: VideoProcessorOptions) {
    await this.destroy();
    await this.init(options);
  }

  async destroy() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = undefined;
    this.video?.pause();
    if (this.video) this.video.srcObject = null;
    this.video = undefined;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.processedTrack = undefined;
  }
}
