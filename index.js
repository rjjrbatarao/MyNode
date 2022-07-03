'use strict';
const crypto = require('crypto');
const urlencode = require('urlencode');
const axios = require('axios');
const express = require('express');
const app = express();
const mysql = require('mysql');
const payloadParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('session-id-token');
const Gpio = require('onoff').Gpio;
const port = 3000;


let on_queue = {
  "time" : 0,
  "credit" : 0,
  "etime":0,
  "edata":0,
  "echarge":0, 
  "expiry": 0,
  "bwup": 0,
  "bwdown": 0,        
  "progress" : 100,
  "queue" : true,
  "state": 0  
}

let mygpio = {
  "coinsignal": 2,
  "coinenable": 3,
  "buttoncancel": 25
}

let mydata = {
  "time" : 0,
  "credit" : 0,
  "etime":0,
  "edata":0,
  "echarge":0,
  "expiry": 0,
  "bwup": 0,
  "bwdown": 0,      
  "progress" : 100,
  "queue" : false,
  "state": 0 // this set state to idle 0, active 1, cancelled 2 
 };

const StateEnum = {
  "idle": 0,
  //"active": 1,
  "cancelled":2,
  "nointernet": 3
};
//Object.freeze(StateEnum);

let coinenable;
let coinsignal;
let buttoncancel;
let progress_time;
let time_price = [];
let time_value = [];
let time_expiry = [];
let time_bwup = [];
let time_bwdown = [];
let data_price = [];
let data_value = [];
let data_expiry = [];
let data_bwup = [];
let data_bwdown = [];
let charge_price = [];
let charge_value = [];
let charge_expiry = [];
let charge_bwup = [];
let charge_bwdown = [];
let api_token;
let api_key;

let q = new Queue();

(function(){
  setTimeout(()=>{
    sendGetInfoRequest();
  },2000);  
}());


const setGpio = (gpio) => {
  buttoncancel = new Gpio(gpio.buttoncancel, 'in', 'falling', {debounceTimeout: 10});
  coinenable = new Gpio(gpio.coinenable, 'out');
  coinsignal = new Gpio(gpio.coinsignal, 'in', 'falling', {debounceTimeout: 10}); 
  coinsignal.watch((err, value) => {
    if (err) {
      throw err;
    }
    mydata.credit++;
    valueConverter(mydata.credit,time_price,time_value,time_expiry,time_bwup,time_bwdown).then(dt => mydata.etime = dt);
    valueConverter(mydata.credit,data_price,data_value,data_expiry,data_bwup,data_bwdown).then(dt => mydata.edata = dt);
    valueConverter(mydata.credit,charge_price,charge_value,charge_expiry,charge_bwup,charge_bwdown).then(dt => mydata.echarge = dt);
  });
  buttoncancel.watch((err, value) => {
    if (err) {
      throw err;
    }
    mydata.state = StateEnum.cancelled;
  });    
}

const con = mysql.createConnection({
  host: "localhost",
  user: "myuser",
  password: "@secret!23",
  database: "myhotspot"
});

con.connect(function(err) {
  if (err) throw err;
  con.query("SELECT * FROM satellites WHERE mode='main'", function (err, result, fields) {
    if (err) throw err;
    api_token = result[0].token;
    api_key = result[0].key;
  });
});

async function valueConverter(credit,price,value,expiry,bwup,bwdown){
  let equivalent = 0;
  let rateN = price.length() - 1;
  let c;
  let pos = 0;
  while (rateN >= 0 && credit > 0) {
    if(credit >= price[rateN]){
      if(pos == 0){
        mydata.expiry = expiry[rateN];
        mydata.bwup = bwup[rateN];
        mydata.bwdown = bwdown[rateN];
        console.log(expiry[rateN],bwup[rateN],bwdown[rateN]);
      }
      pos++;
      c = credit / price[rateN];
      equivalent += c * value[rateN];
      credit -= c * price[rateN];
    }
    rateN--;
  }
  return equivalent;
}


const turnOn = () => {
  coinenable.write(1);
}

const turnOff = () => {
  coinenable.write(0);
}

process.on('SIGINT', _ => {
  coinenable.unexport();
  coinsignal.unexport();
  process.exit(0);
});

app.use(payloadParser.urlencoded({ extended: true }));
app.use(cookieParser());


app.get('/node/reset', (req, res) => {
  countCredit = 0;
  mydata.credit = 0;
  res.send(`count: ${count}`);
});

app.get('/node/on', (req, res) => {
  turnOn();
  res.send(`count: ${count}`);
});

app.get('/node/off', (req, res) => {
  turnOff();
  res.send(`count: ${count}`);
});

/*
Test dummy path
*/
app.get('/node', (req, res) => {
  countCredit = 0;
  res.send(`count: ${count}`);
});

/*
Events
*/
var tick = false;
var timer;
var progress_ratio;

function mytimer(){
  if(!tick){
    tick = true;
    progress_ratio = 100/progress_time;
    timer = setInterval(() => countdown(),1000);
  }
}

function cancelHandler(){
  if(mydata.state == StateEnum.cancelled){
    mydata.state = StateEnum.idle;
    mydata.time = 0;
    mydata.progress = 100;
    console.log("queue len ",q.length());    
  }
}

function counter(res,req,count) {
  if(mydata.time){
    if(req.cookies.sessionId == q.peek()){
      res.write("data: " + JSON.stringify(mydata) + "\n\n");
      cancelHandler();
    } else {
      res.write("data: " + JSON.stringify(on_queue) + "\n\n");
    }
  } else {
    if(req.cookies.sessionId == q.peek()){
      console.log("ended session " + req.cookies.sessionId);
    }
    if(q.length() == 0){
      count = 0;
    } else {
      count = progress_time;
    }
  }
  if (count) {
      setTimeout(() => counter(res,req,count-1), 1000);
  }
}

function countdown() {
  console.log("countdown",mydata.time);
  if (mydata.time){
    mydata.time--;
    mydata.progress -=  progress_ratio;
  } else {
    if(q.length() == 1){
      console.log("clear timer");
      clearInterval(timer);
      tick = false;
    }
    q.dequeue();
    mydata.time = progress_time;
    mydata.progress = 100;
  }
}

app.get('/node/register', (req, res) => { 
  
  mydata.state = StateEnum.idle;
  let session_cookie;
  let headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  };

  if(req.cookies.sessionId != null){
    if(session.validateSessionToken(req.cookies.sessionId,api_key)){
      console.log('session '+req.cookies.sessionId+' is set and valid');
      if(q.isUnique(req.cookies.sessionId)){
        q.enqueue(req.cookies.sessionId);
      }    
    } else {
      console.log('session '+req.cookies.sessionId+' is invalid');
      session_cookie = session.generateSessionToken(api_key);
      headers['Set-Cookie'] = 'sessionId='+session_cookie+'; Max-Age=2592000';
    }
  } else {
    session_cookie = session.generateSessionToken(api_key);
    q.enqueue(session_cookie);
    console.log('created '+session_cookie+' session cookie');
    headers['Set-Cookie'] = 'sessionId='+session_cookie+'; Max-Age=2592000';    
  }

  console.log("current user served: ",q.peek());
  console.log("total queued users ", q.length());
  console.log("queue contents ", q.contents());

  res.writeHead(200, headers);

  mytimer(res);
  counter(res,req,mydata.time);

  req.on("close", function() {
    if(req.cookies.sessionId != q.peek()){
      console.log("queued client "+req.cookies.sessionId+" closed connection scheduled for purging");
      q.purge(req.cookies.sessionId); 
    } else if(req.cookies.sessionId == q.peek() && mydata.credit == 0){
      console.log("current client "+req.cookies.sessionId+" closed connection scheduled for purging");
      q.purge(req.cookies.sessionId);
    }
    
    console.log("queue contents ", q.contents());  
  });

});

app.post('/node/cancel', (req, res) => {
  if(req.cookies.sessionId == q.peek()){
    mydata.time = 0;
    mydata.progress = 100;
    console.log("queue len ",q.length());    
  }
  res.write('done');
  res.end();  
});

const encrypt = ((val,md5_key,iv) => {
  console.log("md5_key",md5_key);
  let cipher = crypto.createCipheriv('aes-256-cbc', md5_key, iv);
  let encrypted = cipher.update(val, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
});

const sendSetUserRequest = async(res, body) => {
  let data = {
    'service': body.service_name,
    'package': body.package_name,
    'credits': mydata.credit,
    'etime': mydata.etime,
    'edata': mydata.edata,
    'echarge': mydata.echarge,
    'expiry': mydata.expiry,
    'bwup': mydata.bwup,
    'bwdown': mydata.bwdown
  };
  let md5_key = crypto.createHash('md5').update(api_key).digest("hex");
  let iv = crypto.randomBytes(8).toString('hex');
  let encrypted_data = encrypt(JSON.stringify(data),md5_key,iv);  
  let hmac_signature = crypto.createHmac('sha256', md5_key).update(encrypted_data).digest('hex');  
  try{
    const resp = await axios.get(`http://127.0.0.1/api/node/set/user?api_token=${api_token}&data=${urlencode(iv+':'+hmac_signature+':'+encrypted_data)}`);
    console.log(resp.data);
    res.write('{"status": "success"}');
    res.end();   
  } catch (err){
    console.log(err);
  }
}

const setTimeRates = (rates) => {
  time_price = [];
  time_value = [];
  time_expiry = [];  
  time_bwup = [];
  time_bwdown = [];
  rates.forEach(element => {
    time_price.push(parseInt(element.price_name));
    time_value.push(parseInt(element.value_name));
    time_expiry.push(parseInt(element.expiry_name));
    time_bwup.push(parseInt(element.bwup_name));
    time_bwdown.push(parseInt(element.bwdown_name));
  });
  console.log(time_price,time_value,time_expiry,time_bwup,time_bwdown);
};
const setDataRates = (rates) => {
  data_price = [];
  data_value = [];
  data_expiry = [];
  data_bwup = [];  
  data_bwdown = [];  
  rates.forEach(element => {
    data_price.push(parseInt(element.price_name));
    data_value.push(parseInt(element.value_name));
    data_expiry.push(parseInt(element.expiry_name));
    data_bwup.push(parseInt(element.bwup_name));
    data_bwdown.push(parseInt(element.bwdown_name));
  });
  console.log(data_price,data_value,data_expiry,data_bwup,data_bwdown);
};
const setChargeRates = (rates) => {
  charge_price = [];
  charge_value = [];
  charge_expiry = [];
  charge_bwup = [];  
  charge_bwdown = [];     
  rates.forEach(element => {
    charge_price.push(parseInt(element.price_name));
    charge_value.push(parseInt(element.value_name));
    charge_expiry.push(parseInt(element.expiry_name));
    charge_bwup.push(parseInt(element.bwup_name));
    charge_bwdown.push(parseInt(element.bwdown_name));    
  });
  console.log(charge_price,charge_value,charge_expiry,charge_bwup,charge_bwdown);
};


const sendGetInfoRequest = async() => {
  let data = {
    'time' : true, // this is request to get time if enabled
    'data':true,
    'charge':true,
  };
  let md5_key = crypto.createHash('md5').update(api_key).digest("hex");
  let iv = crypto.randomBytes(8).toString('hex');
  let encrypted_data = encrypt(JSON.stringify(data),md5_key,iv); 
  let hmac_signature = crypto.createHmac('sha256', md5_key).update(encrypted_data).digest('hex');  
  try {
    const resp = await axios.get(`http://127.0.0.1/api/node/get/info?api_token=${api_token}&data=${urlencode(iv+':'+hmac_signature+':'+encrypted_data)}`);
    setTimeRates(resp.data.data.mytimerates);
    setDataRates(resp.data.data.mydatarates);
    setChargeRates(resp.data.data.mychargerates);
    setGpio(mygpio);
    mydata.time = resp.data.data.myprogresstime;
    on_queue.time = resp.data.data.myprogresstime;
    progress_time = resp.data.data.myprogresstime;
  } catch (err){
    console.log(err);
  }
}


app.post('/node/login', (req, res) => {
  console.log('body------------->',req.body);
  console.log('cookie---------->',req.cookies);
  console.log('Signed Cookies: ', req.signedCookies)
  if(mydata.credit != 0){
    res.write('{"status": "invalid"}');
    res.end();   
  } else {
    sendSetUserRequest(res,req.body); 
    mydata.time = 0;
    mydata.progress = 100;
    mydata.credit = 0;
    mydata.etime = 0;
    mydata.edata = 0;
    mydata.echarge = 0;
    mydata.expiry = 0;
    mydata.bwup = 0;
    mydata.bwdown = 0;
    mydata.state = StateEnum.idle;    
  } 
});

app.post('/node/test', (req, res) => {
  sendGetInfoRequest();  
});

//crypto

app.listen(port, () => {
  console.log(`node listening at http://localhost:${port}`);
});


//queue
function Queue(){
  this.unique = true;
  this.elements = [];
}

Queue.prototype.enqueue = function(e){
  this.elements.push(e);
}

Queue.prototype.dequeue = function(){
  return this.elements.shift();
}

Queue.prototype.isEmpty = function() {
  return this.elements.length == 0;
}

Queue.prototype.peek = function () {
  return !this.isEmpty() ? this.elements[0] : undefined;
};

Queue.prototype.length = function() {
  return this.elements.length;
}

Queue.prototype.isUnique = function(e) {
  this.unique = true;
  this.elements.forEach(element => {
    if(e === element){
      console.log("duplicate: ", element);
      this.unique = false;
    } 
  });
  return this.unique;
}

Queue.prototype.contents = function(){
  return this.elements;
}

Queue.prototype.purge = function(e){
  this.elements.forEach((element,index) => {
    if(e === element){
      console.log("removed: ", element);
      this.elements.splice(index,1);
    } 
  });
}