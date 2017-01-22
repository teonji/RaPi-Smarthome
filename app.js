// jshint esversion: 6
// Created by: Sebastian Moehn
// Date: October, 2016


// -----------------------------
// - Require & Variables Setup -
// -----------------------------

  // - Config File(s) -
  var config = require('./config'); // Includes DB Info, etc.

  // - Include Packages -
  var express = require('express'); // Web - Framework
  var doT = require('express-dot'); // Templating Engine
  var compression = require('compression'); // Gzip/deflate outgoing responses
  var app = express(); // Create an app based on Express
  var server = require('http').Server(app); // HTTP Server, based on the Express app
  var io = require('socket.io')(server); // IO Socket, based on the Server
  var needle = require('needle'); // HTTP Requests Handler
  var parseString = require('xml2js').parseString; // Used to transform XML to JSON
  var WebSocket = require('ws'); // WebSocket Framework (listen to BOSE device changes)
  var mdns = require('mdns'); // MDNS Tool to discover devices

  // - Database Setup -
  var dbUrl = config.couchDB.protocol+config.couchDB.ip+":"+config.couchDB.port; // Database URL (from Config File)
  var nano = require('nano')(dbUrl); // Connect to CouchDB using nano
  var db = nano.use(config.couchDB.db_automation); // Connect to Database

  // - Define Variables -

    // -- Device commands --
    var cmd = 'pilight-send -p'; //Command to send with "pilight" and -p for Protocol (Rest comes from DB)

    // -- Available Categories and Objects --
    var myGroups = Array();
    var myObjects = Array();
    var objectsScanned = false;

    // -- Available Devices and Alarms --
    var myBoseDevices = Array();
    var activeBoseSystem = {name: "none"};
    var alarmsArr = Array(); // Save all Alarms

    // -- Other variables --
    var weekday = new Array("So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"); // Array holding all days


// ----------------
// - Server Setup -
// ----------------

  // - Listen for paths -
  app.set('views', __dirname+'/views'); // Template files are stored here
  app.set('view engine', 'dot'); // Use dot Templating
  app.engine('dot', doT.__express); // Use dot Engine based on Express
  app.use(compression()); // Use file compression
  app.use(express.static(__dirname + '/public')); // All Public files are stored here

  // - Routes -
  app.get('/', boseRoute); // Standard route (usually redirects to subroute)
  //app.get('/home', boseRoute); // Shows all categories and objects
  //app.get('/manage', manageRoute); // Manage categories and objects
  //app.get('/bose', boseRoute); // Control BOSE devices
  //app.get('/alarm', alarmRoute); // Manage alarms for BOSE devices
  //app.get('/info', infoRoute); // Show generall app information

  // - Route Functions -

    // -- Home route --
    function homeRoute(req, res) {
      res.redirect('/'); // Redirect to BOSE route
      // myGroups = []; // Reset variables if loaded again
      // myObjects = [];
      // objectsScanned = false;
      //
      // db.view('show', 'groups', function(err, groupBody) { // Read all Groups
      //   if (!err) {
      //     db.view('show', 'btns', function(err, objectBody) { // Read all Objects
      //       if (!err) {
      //         groupBody.rows.forEach(function(groupDoc) { // For each Group
      //           groupDoc.devices = Array(); // Store all objects here
      //           objectBody.rows.forEach(function(objectDoc) { // For each Object
      //             if(objectDoc.value.groupid == groupDoc.id) { // Does this object belong to the group?
      //               groupDoc.devices.push(objectDoc);
      //             }
      //             if(!objectsScanned) {
      //               myObjects.push(objectDoc.value);
      //             }
      //           });
      //           myGroups.push(groupDoc); // Save the group to an array
      //           objectsScanned = true; // Only save the objects once (not for every group)
      //         });
      //
      //         res.render('index', {items: myGroups}); // Render and pass variables
      //       }
      //     });
      //   }
      // });
    }

    // -- Manage route --
    function manageRoute(req, res) {
      db.view('show', 'groups', function(err, body) { // Load all avilable groups
        if (!err) { // If there's no error
          items = body.rows;
          res.render('manage', {items: items}); // Render the manage template and pass the groups
        }
      });
    }

    // -- Bose Music route --
    function boseRoute(req, res) {
      res.render('bose', {items: myBoseDevices}); // Render the bose template with info about all devices
    }

    // -- Alarm Route --
    function alarmRoute(req, res) {
      loadAlarms(); // Load all alarms
      res.render('alarm', ""); // Render the alarms template
    };

    // -- Info route --
    function infoRoute(req, res) {
          res.render('info', {}); // Just render the template
    }

  // - Start Server -
  server.listen(3000, function() { // Create Server on port 3000
    console.log('listening on http://localhost:3000');
  });


// ---------------------
// - General Functions -
// ---------------------

  // - Helpers for the routes -
  function loadAlarms() {
    var sendUrl = "http://localhost:3333/api/timer"; // URL to communicate with the timer API

    needle.get(sendUrl, function(error, response) {
      if (!error && response.statusCode == 200) {
        if(!response.body.hasOwnProperty('error')) { // If response was recieved and is not an error
          alarmsArr = []; // Empty the Alarms array
          response.body.alarms.forEach(function(alarm) { // Do for each alarm recieved
            var myAlarm = {}; // Create a new alarm object
            myAlarm = alarm; // Copy the object from the DB to the alarm object
            myAlarm.time = transformTime(alarm.time.split(":"), "add"); // Normalize the Alarm time, as the backend script works without "0" infront
            myAlarm.days = transformDays(alarm.days); // Normalize days, as backend script needs integers and we want actual days
            alarmsArr.push(myAlarm); // Add alarm to the Array
          });
          io.sockets.emit('getAlarmsStatus', alarmsArr); // Respond with JSON Object holding all the alarms
        }else{
          io.sockets.emit('getAlarmsStatus', {error: true, desc: "Could not load alarms from server"}); // Respond with JSON Error
        }
      }else{
        console.log(error);
        io.sockets.emit('getAlarmsStatus', {error: true, desc: "Could talk to server (asking for alarms)"}); // Respond with JSON Error
      }
    });
  }

  // - Send a command to Intertechno Device -
  function sendToDev(obj, data) {
    var devcmd = obj.code;
    var stat = data.status;
    var send = "";

    send = cmd+" "+devcmd;
    if(stat == 1) {
      send =  send + " -t";
    }else{
      send =  send + " -f";
    }

    console.log('Device - Command: '+send); // TODO: Exec won't work anymore, use something else?
    exec(send+" && "+send+" && "+send, function (err, stdout, stderr) { // e.g. pilight-send -p kaku_switch -i 4762303 -u 0 -t
      if (err) {
        console.log('exec error: ' + err);
      }else{
        console.log(stdout);
        obj.status = stat;
        io.sockets.emit('btnActionPressedStatus', obj); // Respond with JSON Object of btnData
      }
    });
  }

  // - Send a command to BOSE Device -
  function sendToBose(obj, data) {
    var devcmd = 'curl -X POST '+obj.code+"/key -d '<key state=\"press\" sender=\"Gabbo\">POWER</key>'"; // Command string (See BOSE documentation)
    var stat = data.status;

    console.log('Device - Command: '+send);
    exec(devcmd, function (err, stdout, stderr) { // Exceute command
      if (err) {
        console.log('exec error: ' + err);
      }else{
        console.log(stdout);
      }
    });

    obj.status = stat;
    io.sockets.emit('btnActionPressedStatus', obj); // Respond with JSON Object containing the object
  }

// -----------------------
// - Helper Functions -
// -----------------------

  // - Either adds or removes leading 0s -
  function transformTime(myTime) { // Expects Array with two Strings "XX":"xx"
    if(myTime[0].length == 1) {
      myTime[0] = "0"+myTime[0];
    }
    if(myTime[1].length == 1) {
      myTime[1] = "0"+myTime[1];
    }
    return myTime[0]+":"+myTime[1];
  }

  // - Transforms numbers to days -
  function transformDays(myDays) { // Expects values from 0-6 (So-Sa)
    var newDays = Array(); // Create new array
    myDays.forEach(function(day) { // For each day
      newDays.push(weekday[day]); // Add correct Name to Array
    });
    return newDays;
  }

// ----------------------------
// - BOSE Music Functions -
// ----------------------------

// - Watch and recieve devices -
// -- Watch all http servers --
// function requestDevices() {
//   needle.get('http://localhost:3333/api/systems', function(err, resp) {
//     if (!err) {
//       if(resp.body.data[0].name == "none" && deviceRequests < 10) {
//         console.log("I only find 'None' device, I'll try harder...");
//         deviceRequests++;
//         setTimeout(requestDevices, 500);
//       }else{
//         myBoseDevices = resp.body.data
//         console.log(myBoseDevices);
//       }
//     }else{ // API couldn't be called
//       console.log("Problem requesting Bose device from wecker.js via API");
//       setTimeout(requestDevices, 500);
//     }
//   });
// }
// var deviceRequests = 0;
// requestDevices();
// -- Watch all http servers --
var sequence = [
    mdns.rst.DNSServiceResolve(),
    'DNSServiceGetAddrInfo' in mdns.dns_sd ? mdns.rst.DNSServiceGetAddrInfo() : mdns.rst.getaddrinfo({families:[0]}),
    mdns.rst.makeAddressesUnique()
];
var browser = mdns.createBrowser(mdns.tcp('soundtouch'), {resolverSequence: sequence});

// -- Read broadcasting devices and save them --
browser.on('serviceUp', function(service) {
  var newDevice = {};
  newDevice.name = service.name;
  newDevice.ip = service.addresses[0]
  newDevice.cmdPort = service.port; // Command Port
  newDevice.wsPort = '8080'; // WebSocket Port
  newDevice.MAC = service.txtRecord.MAC;

  var sendUrl = 'http://'+newDevice.ip+":"+newDevice.cmdPort+'/info';
  needle.get(sendUrl, function(error, response) {
    if (!error && response.statusCode == 200) {
      newDevice.type = response.body.info.type;
      newDevice.Account = response.body.info.margeAccountUUID;

      needle.get('http://'+newDevice.ip+":"+newDevice.cmdPort+'/now_playing', function(error, response) {
        if (!error && response.statusCode == 200) {
          newDevice.power = response.body.nowPlaying.$.source;
          myBoseDevices.push(newDevice);
          console.log("Found service: "+service.name+" ("+newDevice.power+") - IP: "+service.addresses[0]+":"+service.port+" - MAC: "+service.txtRecord.MAC);
          boseSystemsLoaded = true;
        }else{
          console.log("Error getting additional info");
        }
      });
    }else{
      console.log("Error asking: "+newDevice.name+" for information. No device saved!");
    }
  });
});

// -- Listen to devices that go down --
browser.on('serviceDown', function(service) {
  console.log(service);
  // TODO: Remove device from myBoseDevices
});
browser.start();


// - Send Key -
function boseKey(data) {
  var key = data[0];
  xml='<key state="press" sender="Gabbo">'+key+'</key>';
  post('key', xml, 'boseButtonPressedStatus', Array(data[1]));
  xml='<key state="release" sender="Gabbo">'+key+'</key>';
  post('key', xml,'boseButtonPressedStatus', Array(data[1]));
}

// - Do a Post -
function post(page, str, socketName, socketBody) {
  console.log(str);
  var sendUrl = 'http://'+activeBoseSystem.ip+':'+activeBoseSystem.cmdPort+'/'+page;
  needle.post(sendUrl, str, function(error, response) {
    if (!error && response.statusCode == 200) {
      console.log(response.body);
      socketBody.push("success");
    }else{
      socketBody.push("error");
    }
    io.sockets.emit(socketName, socketBody); // Respond with JSON Object of btnData
  });
}

var connection; // WebSocket Connection
function listen() {
  if(activeBoseSystem.name !== "none") {
    connection = new WebSocket('ws://' + activeBoseSystem.ip + ':' + activeBoseSystem.wsPort, "gabbo");
    connection.onopen = function() {   console.log("Connection open to: "+activeBoseSystem.name); };
    connection.onmessage = function(e) {
      listenToData(e.data);
    };
    connection.onclose = function() {   console.log("Connection closed to: "+activeBoseSystem.name); };
    connection.onerror = function() {
      console.log("Connection error. ");
      setTimeout(listen, 1000);
    };
  }else{
    //console.log("Currently no BOSE System to listen... (retry in 1s)");
    setTimeout(listen, 1000);
  }
}
listen();

function listenToData(data) {
  parseString(data, function (err, result) {
      cString = result;
  });

  handleBoseData(cString, "update");
}

function handleBoseData(cString, type) {
  var boseInfo = { };
  var stopSending = false; // Prevent from sending
  // Normalize data from Update Info or Requested Info
  boseInfo.device = "none";
  if(cString.hasOwnProperty('updates')) {
    boseInfo.device = cString.updates.$.deviceID;
  }else if(cString.hasOwnProperty('nowPlaying')) {
    boseInfo.device = cString.nowPlaying.$.deviceID;
  }else if(cString.hasOwnProperty('volume')) {
    boseInfo.device = cString.volume.$.deviceID;
  }else{
    console.log("DEVICE not found...");
    console.log(cString);
  }
  if(type == "update") { // It's Update Information
    console.log("-- Song updated! for: "+boseInfo.device+" --");

    boseInfo.method = "update";
    if(cString.updates.nowPlayingUpdated) {
      boseInfo.type = "Music";
      boseInfo.source = cString.updates.nowPlayingUpdated[0].nowPlaying[0].$.source;
    }else if(cString.updates.volumeUpdated) {
      boseInfo.type = "Volume";
    }else if(cString.updates.connectionStateUpdated) {
      boseInfo.type = "Connection";
    }
  }else{ // It's requested Information
    console.log("-- Song information! for: "+boseInfo.device+" --");

    boseInfo.method = "info";
    if(cString.nowPlaying) {
      boseInfo.type = "Music";
      boseInfo.source = cString.nowPlaying.$.source;
    }else{
      boseInfo.type = "Volume";
    }
  }

  if(boseInfo.type == "Music") {
    if(boseInfo.source == "SPOTIFY") { // Playing Spotify
      if(boseInfo.method == "update") {
        try {
          boseInfo.artist = cString.updates.nowPlayingUpdated[0].nowPlaying[0].artist[0];
          boseInfo.time = cString.updates.nowPlayingUpdated[0].nowPlaying[0].time[0];
          boseInfo.track = cString.updates.nowPlayingUpdated[0].nowPlaying[0].track[0];
          boseInfo.trackID = cString.updates.nowPlayingUpdated[0].nowPlaying[0].trackID[0];
          boseInfo.album = cString.updates.nowPlayingUpdated[0].nowPlaying[0].album[0];
          boseInfo.coverArt = cString.updates.nowPlayingUpdated[0].nowPlaying[0].art[0]._;
        } catch (err) {
          console.log("!!!!! ERROR !!!!!");
          console.log(err);
          console.log("Bad cString!");
          console.log(cString);
          console.log("more");
          console.log(cString.updates.nowPlayingUpdated[0]);
        }
      }else{
        boseInfo.artist = cString.nowPlaying.artist;
        boseInfo.track = cString.nowPlaying.track;
        boseInfo.trackID = cString.nowPlaying.trackID;
        boseInfo.album = cString.nowPlaying.album;
        boseInfo.coverArt = cString.nowPlaying.art._;
      }
    }else if(boseInfo.source == "INTERNET_RADIO") { // Playing Radio
        console.log("RADIOOOOO!");
        if(boseInfo.method == "update") {
          boseInfo.stationName  = cString.updates.nowPlayingUpdated[0].nowPlaying[0].stationName[0];
          boseInfo.description = cString.updates.nowPlayingUpdated[0].nowPlaying[0].description[0];
          boseInfo.coverArt = cString.updates.nowPlayingUpdated[0].nowPlaying[0].art[0]._;
          boseInfo.stationLocation = cString.updates.nowPlayingUpdated[0].nowPlaying[0].stationLocation[0];
        }else{
          boseInfo.stationName  = cString.nowPlaying.stationName ;
          boseInfo.description = cString.nowPlaying.description;
          boseInfo.coverArt = cString.nowPlaying.art._;
          boseInfo.stationLocation = cString.nowPlaying.stationLocation;
        }
    }else if(boseInfo.source == "STORED_MUSIC") { // STORED_MUSIC
        console.log("STORED_MUSIC!");
        if(boseInfo.method == "update") {
            if(cString.updates.nowPlayingUpdated[0].nowPlaying[0].hasOwnProperty('artist')){
              boseInfo.artist = cString.updates.nowPlayingUpdated[0].nowPlaying[0].artist[0];
              boseInfo.time = cString.updates.nowPlayingUpdated[0].nowPlaying[0].time[0];
              boseInfo.track = cString.updates.nowPlayingUpdated[0].nowPlaying[0].track[0];
              boseInfo.album = cString.updates.nowPlayingUpdated[0].nowPlaying[0].album[0];
              boseInfo.coverArt = cString.updates.nowPlayingUpdated[0].nowPlaying[0].art[0]._;
            }
        }else{
            if(cString.nowPlaying.hasOwnProperty('artist')){
              boseInfo.artist = cString.nowPlaying.artist;
              boseInfo.track = cString.nowPlaying.track;
              boseInfo.trackID = cString.nowPlaying.trackID;
              boseInfo.album = cString.nowPlaying.album;
              boseInfo.coverArt = cString.nowPlaying.art._;
            }
        }
    }
    if(!stopSending) {
      io.sockets.emit('boseInfoUpdate', boseInfo); // Respond with JSON Object of btnData
      console.log("____!!!! I did send !!!!_____");
      console.log(boseInfo);
    }else{
      console.log("!!I DID NOT SEND THIS SHIT");
      stopSending = false;
    }
  }else if(boseInfo.type == "Volume") {
    console.log("- Volume updated -");
    if(boseInfo.method == "update") {
      volume = cString.updates.volumeUpdated[0].volume[0].targetvolume[0];
      muted = cString.updates.volumeUpdated[0].volume[0].muteenabled[0];
    }else{
      volume = cString.volume.targetvolume;
      muted = cString.volume.muteenabled;
    }
    io.sockets.emit('boseVolumeUpdate', [volume, muted]); // Respond with JSON Object of btnData
  }else if(boseInfo.type == "Connection") {
    console.log(" - Connection updated -");
    console.log(boseInfo);
  }
}

// ------------------------
// - Socket.io Settings -
// ------------------------

// - General Socket.io Connection -
io.on('connection', function(socket){
  console.log('a user connected');

  socket.on('disconnect', function(){
    console.log('user disconnected');
  });

  socket.on('btnActionPressed', actionButtonPressed);
  socket.on('btnCategorySave', createNewCategory);
  socket.on('btnObjectSave', createNewObject);
  socket.on('boseWhatsPlaying', boseWhatsPlaying);
  socket.on('boseGetVolume', boseGetVolume);
  socket.on('boseButtonPressed', boseButtonPressed);
  socket.on('boseGetSystem', boseGetSystem);
  socket.on('boseGetDevices', boseGetDevices);
  socket.on('boseDeviceButtonPressed', boseDeviceButtonPressed);
  socket.on('alarmActiveState', alarmActiveState);
  socket.on('alarmActiveChanged', alarmActiveChanged);
  socket.on('alarmSaved', alarmSaved);
  socket.on('alarmEdited', alarmEdited);
  socket.on('alarmDelete', alarmDelete);
  socket.on('alarmEdit', alarmEdit);
  socket.on('getAlarms', getAlarms);
  socket.on('boseSleeptimer', boseSleeptimer);
  socket.on('boseGetTimers', boseGetTimers);
  socket.on('boseSleeptimerRemove', boseSleeptimerRemove);
});


// - Socket Helper-Functions -

  // -- Handle Button Press --
  function actionButtonPressed(data, callback) {
    var currentObject = myObjects.find(x=> x._id === data.id); // Find Object where _id equals data.id

    if(typeof currentObject.commandtype === 'undefined') {
      sendToDev(currentObject, data);
    }else{
      if(currentObject.commandtype == "BOSE") {
        sendToBose(currentObject, data);
      }
    }
  }

  // -- Create a new Category --
  function createNewCategory(data, callback) {
    db.insert(data, function(err, body, header) { // Update button
      if (err) {
        console.log('[db.insert] ', err.message);
      }else{
        console.log('A new category was created: '+data.name);
        io.sockets.emit('btnCategorySaveStatus', body); // Respond with JSON Object of btnData
      }
    });
  }

  // -- Create a new Object --
  function createNewObject(data, callback) {
    db.insert(data, function(err, body, header) { // Update button
      if (err) {
        console.log('[db.insert] ', err.message);
      }else{
        console.log('A new object was created: '+data.name);
        io.sockets.emit('btnObjectSaveStatus', body); // Respond with JSON Object of btnData
        console.log(body);
      }
    });
  }

  // - Read Bose Information -
  function boseWhatsPlaying(obj, callbacl) {
    if(activeBoseSystem.name !== "none") {
        var sendUrl = 'http://'+activeBoseSystem.ip+':'+activeBoseSystem.cmdPort+'/now_playing';
        needle.get(sendUrl, function(error, response) {
          if (!error && response.statusCode == 200) {
            handleBoseData(response.body, "info"); // Respond with JSON Object of btnData
          }else{
            console.log(error);
          }
        });
      }else{
        console.log("Currently no BOSE system to listen");
      }
  }

  // - Read Bose Volume -
  function boseGetVolume(obj, callback) {
    if(activeBoseSystem.name !== "none") {
      var sendUrl = 'http://'+activeBoseSystem.ip+':'+activeBoseSystem.cmdPort+'/volume';
      needle.get(sendUrl, function(error, response) {
      if (!error && response.statusCode == 200)
        handleBoseData(response.body, "info"); // Respond with JSON Object of btnData
      });
    }else{
      console.log("Currently no BOSE system to listen");
    }
  }

  // - Action on clicking Preset Button -
  function boseButtonPressed(data, callback) {
    boseKey(data);
  }

  // - Respond with active System
  function boseGetSystem(data, callback) {
    var activeSystem = "";
    if(activeBoseSystem.name === "none") {
      activeSystem = "none"
    }else{
      activeSystem = activeBoseSystem.MAC;
    }
    console.log(activeSystem);
    io.sockets.emit('boseGetSystemUpdate', activeSystem); // Respond with JSON Object of btnData
  }

  // - Respond with all known Bose devices -
  function boseGetDevices(data, callback) {
    if(myBoseDevices.length > 0) {
      io.sockets.emit('boseGetDevicesUpdate', myBoseDevices); // Respond with JSON Object of btnData
    }else{
      io.sockets.emit('boseGetDevicesUpdate', {error: true, desc:"No Bose devices found"}); // Respond with JSON Object of btnData
    }
  }

  // - Change active BOSE System -
  function boseDeviceButtonPressed(obj) {
    var newBose = myBoseDevices.find(x=> x.MAC === obj);
    activeBoseSystem = newBose; // Change to new system
    listen(); // Listen to new System
    boseGetSystem(); // Send new active system
    console.log("- Active BOSE System changed: "+newBose.name+" -");
  }

  // -- Change alarm status --
  function alarmActiveState(data, callback) {
    var resp = Array();
    alarmsArr.forEach(function(alarm) { // For each Group
      var myAlarm = {};
      myAlarm._id = alarm._id;
      myAlarm.active = alarm.active;
      resp.push(myAlarm);
    });
    console.log("sending alarm info");
    io.sockets.emit('alarmActiveStateStatus', resp); // Respond with JSON Object of btnData
  }

  // -- Change alarm status --
  function alarmActiveChanged(data, callback) {
    var currentObject = alarmsArr.find(x=> x._id === data[0]); // Find Object where _id equals data.id
    var currentObjectIndex = alarmsArr.findIndex(x=> x._id === data[0]); // Find Object where _id equals data.id
    var myObject = {_rev:currentObject._rev, active:data[1]};
    needle.put('http://localhost:3333/api/timer/'+currentObject._id, myObject, function(err, resp) {
      if (!err) {
        if(resp.body.hasOwnProperty('updated') && resp.body.hasOwnProperty('resp')) { // Everything went ok
          console.log("Changed alarm activity of: "+currentObject.name+" to: "+data[1]); // JSON decoding magic. :)
          console.log(resp.body);
          alarmsArr[currentObjectIndex]._rev = resp.body.resp.rev;
          alarmsArr[currentObjectIndex].active = resp.body.data.active;
          alarmActiveState() // Change alarm state (don't really needed as switch already changed)
          io.sockets.emit('alarmActiveChangedStatus', resp.body); // Respond with JSON Object of btnData
        }else{ // There was an error updating but the API Call was ok
          alarmActiveState() // Change alarm state back to normal
          io.sockets.emit('alarmActiveChangedStatus', resp.body); // Respond with JSON Object of btnData
        }
      }else{ // API couldn't be called
        alarmActiveState() // Change alarm state back to normal
        io.sockets.emit('alarmActiveChangedStatus', {error: true, desc: "Problem accessing the server!"}); // Respond with JSON Object of btnData
      }
    });
  }

  // -- Save a new alarm --
  function alarmSaved(data, callback) {
    var currentObject = alarmsArr.find(x=> x._id === data[0]); // Find Object where _id equals data.id
    var currentObjectIndex = alarmsArr.findIndex(x=> x._id === data[0]); // Find Object where _id equals data.id
    needle.post('http://localhost:3333/api/timer', data, function(err, resp) {
      if (!err) {
        alarmsArr.push(resp.body.data);
        io.sockets.emit('alarmSavedStatus', resp.body); // Respond with JSON Object of btnData
      }else{ // API couldn't be called
        io.sockets.emit('alarmSavedStatus', {error: true, desc: 'Could not call API Server'}); // Respond with JSON Object of btnData
        console.log("Error changing alarm activity");
      }
    });
  }

  // -- Edit an alarm --
  function alarmEdited(data, callback) {
    var currentObjectIndex = alarmsArr.findIndex(x=> x._id === data._id); // Find Object where _id equals data.id

    needle.put('http://localhost:3333/api/timer/'+data._id+'?rev='+data._rev, data, function(err, resp) {
      if (!err) {
        alarmsArr.splice(currentObjectIndex, 1);
        alarmsArr.push(resp.body.data);
        io.sockets.emit('alarmEditedStatus', resp.body); // Respond with JSON Object of btnData
      }else{ // API couldn't be called
        io.sockets.emit('alarmEditedStatus', {error: true, desc: 'Could not call API Server'}); // Respond with JSON Object of btnData
        console.log("Error changing alarm activity");
      }
    });
  }

  // -- Delete an alarm --
  function alarmDelete(data, callback) {
    needle.delete('http://localhost:3333/api/timer/'+data[0]+'?rev='+data[1], 0, function(err, resp) {
      var currentObjectIndex = alarmsArr.findIndex(x=> x._id === data[0]); // Find Object where _id equals data.id
      var cResp = {};
      cResp.id = data[0];
      if(currentObjectIndex > -1) {
        cResp.name = alarmsArr[currentObjectIndex].name;
      }else{
        cResp.name = "already deleted";
      }
      cResp.success = false;
      if (!err) {
        if(!resp.body.hasOwnProperty('error')) { // Everything went ok
          cResp.success = true;
          alarmsArr.splice(currentObjectIndex, 1);
          io.sockets.emit('alarmDeleteStatus', cResp); // Respond with JSON Object of btnData
          console.log("Deleted alarm: "+cResp.name);
        }else{
          io.sockets.emit('alarmDeleteStatus', cResp); // Respond with JSON Object of btnData
          console.log("Error deleting alarm: "+cResp.name);
        }
      }else{ // API couldn't be called
        io.sockets.emit('alarmDeleteStatus', cResp); // Respond with JSON Object of btnData
        console.log("Error deleting alarm: "+cResp.name);
      }
    });
  }

  // -- Delete an alarm --
  function alarmEdit(data, callback) {
    needle.get('http://localhost:3333/api/timer/'+data[0], function(err, resp) {
      if (!err) {
        io.sockets.emit('alarmEditStatus', resp.body); // Respond with JSON Object of btnData
      }else{ // API couldn't be called
        console.log("Error changing alarm activity");
      }
    });
  }

  // -- Get all current alarms --
  function getAlarms(data, callback) {
    loadAlarms();
  }

  // -- Set a Sleeptimer --
  function boseSleeptimer(data, callback) {
    needle.post('http://localhost:3333/api/sleeptimer?time='+data[0]+'&device='+data[1], {}, function(err, resp) {
      if (!err) {
        if(resp.body.hasOwnProperty('data')) { // Everything went ok
          console.log("Created sleeptimer for: "+resp.body.data.device); // JSON decoding magic. :)
          io.sockets.emit('boseSleeptimerStatus', resp.body); // Respond with JSON Object of btnData
        }else{ // There was an error updating but the API Call was ok
          console.log("API Prob, Sleeptimer!");
          io.sockets.emit('boseSleeptimerStatus', resp.body); // Respond with JSON Object of btnData
        }
      }else{ // API couldn't be called
        io.sockets.emit('boseSleeptimerStatus', err); // Respond with JSON Object of btnData
      }
    });
  }

  // -- Delivers all active Sleeptimers --
  function boseGetTimers(data, callback) {
    needle.get('http://localhost:3333/api/sleeptimer/', function(err, resp) {
      if (!err) {
        io.sockets.emit('boseGetTimersStatus', resp.body); // Respond with JSON Object of btnData
      }else{ // API couldn't be called
        console.log("Error changing alarm activity");
        io.sockets.emit('boseGetTimersStatus', err); // Respond with JSON Object of btnData
      }
    });
  }

  // -- Removes a Sleeptimer from a device --
  function boseSleeptimerRemove(data, callback) {
    needle.delete('http://localhost:3333/api/sleeptimer/'+data, 0, function(err, resp) {
      if (!err) {
        io.sockets.emit('boseSleeptimerRemoveStatus', resp.body); // Respond with JSON Object of btnData
      }else{ // API couldn't be called
        io.sockets.emit('alarmDeleteStatus', {error: true, desc: "Could not contact host"}); // Respond with JSON Object of btnData
      }
    });
  }
