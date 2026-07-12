(function(){
  'use strict';
  window.currentUserId='jason';
  window.SUBJECT_COLORS={'主线':'#4CAF50','工作':'#2196F3','家人':'#FF9800','娱乐':'#9C27B0','其他':'#607D8B'};
  window.tasks=[];
  window.selectedDate=shanghaiDate();
  var storageKey='lifeFocusTasks_v1';

  function shanghaiDate(){
    var parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    var values={};parts.forEach(function(p){values[p.type]=p.value});return values.year+'-'+values.month+'-'+values.day;
  }
  function localTasks(){try{return JSON.parse(localStorage.getItem(storageKey)||'[]')}catch(e){return[]}}
  window.saveData=function(){localStorage.setItem(storageKey,JSON.stringify(tasks))};
  function stableId(text){var h=2166136261;for(var i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return 1000000000+(Math.abs(h)%800000000)}
  function mergeRemote(data){
    var local=localTasks(),byKey={};local.forEach(function(t){byKey[t.sourceKey||('local:'+t.id)]=t});
    var entry=data&&data.entries&&data.entries[selectedDate];
    if(entry&&Array.isArray(entry.subjects))entry.subjects.forEach(function(subject){(subject.tasks||[]).forEach(function(item){
      var key=selectedDate+'|'+(item.id||subject.name+'|'+item.title),old=byKey[key],remoteStatus=item.state==='done'?'completed':(item.state==='cancelled'?'cancelled':'pending');
      if(!old)byKey[key]={id:stableId(key),sourceKey:key,sourceTaskId:item.id,name:item.title,subject:subject.name||'其他',description:'来自企微今日重点',plannedDuration:item.estimatedMinutes||45,actualDuration:0,status:remoteStatus,date:selectedDate,fromShared:true};
      else{old.sourceTaskId=item.id;old.name=item.title;old.subject=subject.name||old.subject;old.plannedDuration=item.estimatedMinutes||old.plannedDuration;old.status=remoteStatus}
    })});
    window.latestRemoteTimeBlocks=entry&&Array.isArray(entry.timeBlocks)?entry.timeBlocks:[];
    tasks=Object.keys(byKey).map(function(k){return byKey[k]}).filter(function(t){return t.date===selectedDate});saveData();
  }
  function escapeHtml(value){var el=document.createElement('span');el.textContent=value||'';return el.innerHTML}
  window.renderTaskList=function(){
    var host=document.getElementById('taskList');if(!host)return;var visible=tasks.filter(function(t){return t.date===selectedDate&&t.status!=='cancelled'});
    if(!visible.length){host.innerHTML='<div class="empty">企微还没有今天的重点，也可以先手动添加。</div>';return}
    host.innerHTML=visible.map(function(t){var color=SUBJECT_COLORS[t.subject]||SUBJECT_COLORS['其他'];return '<div class="task-card card-hover '+(t.status==='completed'?'completed':'')+'" draggable="true" data-task-id="'+t.id+'" style="--task-color:'+color+'"><input type="checkbox" '+(t.status==='completed'?'checked':'')+' data-task-check="'+t.id+'"><div class="task-copy"><strong>'+escapeHtml(t.name)+'</strong><small>'+escapeHtml(t.subject)+' · '+(t.plannedDuration||45)+' 分钟</small></div></div>'}).join('');
    host.querySelectorAll('[data-task-check]').forEach(function(box){box.addEventListener('change',function(){var task=tasks.find(function(t){return String(t.id)===String(box.dataset.taskCheck)});if(task){task.status=box.checked?'completed':'pending';saveData();renderTaskList();if(window.TimeBlock)TimeBlock.refresh();if(window.LifeFocusRemote&&task.sourceTaskId)LifeFocusRemote.enqueue('task_state',{date:selectedDate,taskId:task.sourceTaskId,state:box.checked?'done':'open'})}})});
    if(window.TimeBlock&&TimeBlock.bindTaskDragEvents)TimeBlock.bindTaskDragEvents();
  };
  window.updateStatistics=function(){};window.renderCalendar=function(){};
  window.showNotification=function(message){var el=document.createElement('div');el.className='time-block-toast';el.textContent=message;document.body.appendChild(el);setTimeout(function(){el.remove()},4000)};
  function setStatus(kind,text){var el=document.getElementById('syncStatus');el.className='status '+kind;el.querySelector('span').textContent=text}
  function sync(){
    var btn=document.getElementById('syncBtn');btn.disabled=true;setStatus('','正在读取今日重点…');
    return fetch('data.json?t='+Date.now(),{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(data){mergeRemote(data);renderTaskList();if(window.TimeBlock)TimeBlock.refresh();setStatus('ready','已同步，最后检查 '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}))}).catch(function(e){tasks=localTasks().filter(function(t){return t.date===selectedDate});renderTaskList();setStatus('error','同步失败，暂时显示本地任务')}).finally(function(){btn.disabled=false});
  }
  function addQuick(){var input=document.getElementById('quickTask'),name=input.value.trim();if(!name)return;var id=Date.now(),sourceTaskId='T'+id;tasks.push({id:id,sourceKey:'local:'+id,sourceTaskId:sourceTaskId,name:name,subject:'其他',plannedDuration:45,actualDuration:0,status:'pending',date:selectedDate});input.value='';saveData();renderTaskList();if(window.TimeBlock)TimeBlock.refresh();if(window.LifeFocusRemote)LifeFocusRemote.enqueue('add_task',{date:selectedDate,taskId:sourceTaskId,line:'其他',estimateMinutes:45,title:name})}
  document.getElementById('syncBtn').addEventListener('click',sync);document.getElementById('quickAddBtn').addEventListener('click',addQuick);document.getElementById('quickTask').addEventListener('keydown',function(e){if(e.key==='Enter')addQuick()});
  document.getElementById('todayLabel').textContent=selectedDate+' · 把重要的事放进时间里';sync();setInterval(sync,60000);
})();
