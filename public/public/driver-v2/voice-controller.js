export class VoiceController{
  constructor(){this.enabled=false;this.spoken=new Set()}
  toggle(){this.enabled=!this.enabled;return this.enabled}
  reset(){this.spoken.clear()}
  maybeSpeak(instruction,distance,index){
    if(!this.enabled||!instruction)return;
    let bucket='';if(distance<35)bucket='now';else if(distance<110)bucket='100';else if(distance<330)bucket='300';else if(distance<850)bucket='800';
    if(!bucket)return;const key=index+':'+bucket;if(this.spoken.has(key))return;this.spoken.add(key);
    const lead=bucket==='now'?'':'In '+bucket+' metres, ';this.speak(lead+(instruction.instruction||'continue on route'));
  }
  speak(text){if(!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='en-GB';u.rate=.94;speechSynthesis.speak(u)}
}
