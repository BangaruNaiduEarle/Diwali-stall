import QRCode from 'qrcode'
import jsQR from 'jsqr'
import {open} from 'node:fs/promises'

/** Lossless synthetic camera input, generated solely from the actual exported QR frames. */
export async function videoFrames(frames,file){
 const width=640,height=640,rate=5,repeats=8,uv=Buffer.alloc(width*height/2,128),handle=await open(file,'wx')
 try{
  await handle.write(`YUV4MPEG2 W${width} H${height} F${rate}:1 Ip A1:1 C420jpeg\n`)
  for(const text of frames){
   const symbol=QRCode.create(text,{errorCorrectionLevel:'M'}),size=symbol.modules.size,scale=Math.floor(width/(size+8)),offset=Math.floor((width-size*scale)/2),y=Buffer.alloc(width*height,235)
   for(let row=0;row<size;row++)for(let col=0;col<size;col++)if(symbol.modules.get(row,col))for(let a=0;a<scale;a++)for(let b=0;b<scale;b++)y[(offset+row*scale+a)*width+offset+col*scale+b]=16
   const pixels=new Uint8ClampedArray(width*height*4)
   for(let i=0;i<y.length;i++){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=y[i];pixels[i*4+3]=255}
   if(jsQR(pixels,width,height)?.data!==text)throw Error('Synthetic camera frame failed independent bitmap decoding')
   for(let n=0;n<repeats;n++){await handle.write('FRAME\n');await handle.write(y);await handle.write(uv)}
  }
 }finally{await handle.close()}
 return{file,width,height,frames:frames.length,repeats,framesPerSecond:rate,independentlyDecoded:true,synthetic:true}
}
