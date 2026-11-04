import jsQR from 'jsqr'

export function cameraError(error) {
  if (['NotAllowedError','SecurityError'].includes(error?.name)) return 'Camera permission was denied. Allow Camera in Android Chrome site settings (and Android app permissions), then try again. HTTPS or localhost is required.'
  if (error?.name === 'NotFoundError') return 'No camera was found. Use another device or paste the complete QR frame sequence.'
  if (['NotReadableError','AbortError'].includes(error?.name)) return 'The camera could not start. Close other apps using it and try again.'
  return 'Camera scanning is unavailable on this device. Use HTTPS in Chrome, or paste the complete QR frame sequence.'
}

export async function startQrCamera(video,onFrame,{mediaDevices=globalThis.navigator?.mediaDevices,signal,createCanvas=()=>document.createElement('canvas')}={}) {
  if (!mediaDevices?.getUserMedia) throw Error(cameraError())
  let stream, timer
  const stop = () => { clearInterval(timer); stream?.getTracks().forEach(track=>track.stop()); if (video.srcObject === stream) video.srcObject = null; signal?.removeEventListener('abort',stop) }
  try {
    stream = await mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false})
    if (signal?.aborted) { stop(); return stop }
    signal?.addEventListener('abort',stop,{once:true})
    video.srcObject=stream; video.muted=true; video.playsInline=true; await video.play()
    if (signal?.aborted) { stop(); return stop }
    const canvas = createCanvas(), context = canvas.getContext('2d',{willReadFrequently:true})
    if (!context) throw Error('Canvas unavailable')
    timer = setInterval(()=>{
      if (!video.videoWidth || video.readyState < 2) return
      canvas.width=Math.min(video.videoWidth,1280); canvas.height=Math.round(video.videoHeight*canvas.width/video.videoWidth)
      context.drawImage(video,0,0,canvas.width,canvas.height)
      const pixels=context.getImageData(0,0,canvas.width,canvas.height)
      const decoded=jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'dontInvert'})
      if (decoded?.data) onFrame(decoded.data)
    },200)
    return stop
  } catch (error) { stop(); throw Error(cameraError(error)) }
}
