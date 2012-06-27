// Copyright 2011 Vineet Kumar

"use strict";

var imports = {
  sys: require('sys'),
  events: require('events'),
  repl: require('repl'),
  ttapi: require('ttapi'),
  conf: require('node-config'),
  banlist: require('./banlist'),
  djlist: require('./djlist'),
  Store: require('./store').Store,
  stats: require('./stats'),
  FactBot: require('./facts').FactBot
};

Bot = function (configName) {
  imports.events.EventEmitter.call(this);
  this.ttapi = null;
  this.configName = configName || process.argv[2] || Bot.usage();
  this.config = {};
  this.logChats = false;
  this.commandHandlers = {};
  this.hiddenCommandHandlers = {};
  this.friendCommandHandlers = {};
  this.ownerCommandHandlers = {};
  this.users = {};
  this.useridsByName = {};
  this.usernamesById = {};
  this.activity = {};
  /** @type {Object.<string, DjStats>} */
  this.djs = {};
  /** @type {SongStats} */
  this.currentSong = null;
  this.pendingGreetings = {};
  this.greetings = {};
  this.activity = {};
  this.djList = new imports.djlist.DjList();
  this.banList = null;
};

imports.sys.inherits(Bot, imports.events.EventEmitter);

Bot.usage = function () {
  throw "Usage: " + process.argv[0] + " " + process.argv[1] + " <config name>";
};

Bot.prototype.onInitConfig = function (cb, err) {
  if (err) {
    throw err;
  }
  this.config = imports.conf;
  if (!this.config.noRepl) {
    var replContext = imports.repl.start(this.configName + "> ").context;
    replContext.bot = this;
    replContext.imports = imports;
  }
  this.debug = this.config.debug;
  this.mute = this.config.mute;
  this.muteGreetings = this.config.muteGreetings;
  this.readGreetings();
  this.readActivity();
  this.readUsernames();
  this.ttapi = new imports.ttapi(this.config.auth, this.config.userid, this.config.roomid);
  this.bindHandlers();
  if (cb) {
    cb();
  }
};

Bot.prototype.start = function (cb) {
  imports.conf.initConfig(this.onInitConfig.bind(this, cb), this.configName);
};

Bot.prototype.bindHandlers = function () {
  this.ttapi.on('pmmed', this.onSpeak.bind(this));
  this.ttapi.on('speak', this.onSpeak.bind(this));
  this.ttapi.on('registered', this.onRegistered.bind(this));
  this.ttapi.on('registered', this.onRegisteredFan.bind(this));
  this.ttapi.on('new_moderator', this.onNewModerator.bind(this));
  this.ttapi.on('roomChanged', this.onRoomInfo.bind(this));
  this.ttapi.on('roomChanged', this.initDjList.bind(this));
  this.ttapi.on('roomChanged', this.initBanList.bind(this));
  this.ttapi.on('deregistered', this.onDeregister.bind(this));
  this.ttapi.on('add_dj', this.onAddDj.bind(this));
  this.ttapi.on('rem_dj', this.onRemDj.bind(this));
  this.ttapi.on('snagged', this.onSnagged.bind(this));
  this.ttapi.on('newsong', this.onNewSong.bind(this));
  this.ttapi.on('endsong', this.onEndSong.bind(this));
  this.ttapi.on('nosong', this.onNoSong.bind(this));
  this.ttapi.on('update_votes', this.onUpdateVotes.bind(this));
  this.commandHandlers['help'] = this.onHelp;
  this.commandHandlers['commands'] = this.onHelpCommands;
  this.commandHandlers['friend-commands'] = this.onHelpFriendCommands;
  this.commandHandlers['bonus'] = this.onBonus;
  this.commandHandlers['greet'] = this.onGreet;
  this.commandHandlers['album'] = this.onAlbum;
  this.commandHandlers['last'] = this.onLast;
  this.commandHandlers['plays'] = this.onPlays;
  this.commandHandlers['list'] = this.onList;
  this.commandHandlers['addme'] = this.onAddme;
  this.commandHandlers['removeme'] = this.onRemoveme;
  this.hiddenCommandHandlers['bonys'] = this.onBonus;
  this.hiddenCommandHandlers['autobop'] = this.onAutoBop;
  this.friendCommandHandlers['list-on'] = this.onListOn;
  this.friendCommandHandlers['list-off'] = this.onListOff;
  this.friendCommandHandlers['list-reset'] = this.onListReset;
  this.friendCommandHandlers['reset-list'] = this.onListReset;
  this.friendCommandHandlers['clear-list'] = this.onListReset;
  this.friendCommandHandlers['hop'] = this.onHop;
  this.friendCommandHandlers['hopdown'] = this.onHopDown;
  this.friendCommandHandlers['add-first'] = this.onAddFirst;
  this.friendCommandHandlers['remove'] = this.onRemove;
  this.friendCommandHandlers['remove-first'] = this.onRemoveFirst;
  this.friendCommandHandlers['kick'] = this.onKick;
  this.friendCommandHandlers['ban'] = this.onBan;
  this.friendCommandHandlers['unban'] = this.onUnban;
  this.friendCommandHandlers['bans'] = this.onBans;
  this.friendCommandHandlers['banned'] = this.onBanned;
  this.friendCommandHandlers['approve-greeting'] = this.onApproveGreeting;
  this.friendCommandHandlers['show-greeting'] = this.onShowGreeting;
  this.friendCommandHandlers['reject-greeting'] = this.onRejectGreeting;
  this.friendCommandHandlers['pending-greetings'] = this.onPendingGreetings;
  this.friendCommandHandlers['skip'] = this.onSkip;
  this.friendCommandHandlers['friends'] = this.onFriends;
  this.ownerCommandHandlers['owners'] = this.onOwners;
  this.ownerCommandHandlers['say'] = this.onSay;
  this.ownerCommandHandlers['snag'] = this.onSnag;
};

/* Setup Variables */
var nop = function () {};
var MS_FROM_S = 1000;
var S_FROM_M = 60;
var M_FROM_H = 60;
var H_FROM_D = 24;
var D_FROM_W = 7;
var MS_FROM_W = MS_FROM_S * S_FROM_M * M_FROM_H * H_FROM_D * D_FROM_W;

/* Extending Natives */
if(typeof Object.prototype.indexOf === 'undefined') {
  Object.prototype.indexOf = function (item) {
    for(var i in this) {
      if(!this.hasOwnProperty(i)) continue;
      if(i == item) return true;
    }
    
    return false;
  }
}

var randomElement = function (ar) {
  return ar[Math.floor(Math.random() * ar.length)];
};

Bot.randomElement = randomElement;

/**
 * Pulls the command off the front of a line of text.
 * @return a 2-element list of [command, rest]
 */
Bot.splitCommand = function (text) {
  var i = text.search(/\s/);
  if (i === -1) {
    return [text, ''];
  }
  return [text.substr(0, i), text.substr(i).trimLeft()];
};

Bot.prototype.readGreetings = function () {
  imports.Store.read(this.config.greetings_filename, function (data) {
    this.greetings = data;
    this.emit('greetingsLoaded', Object.keys(this.greetings).length);
  }.bind(this), nop);
  imports.Store.read(this.config.pending_greetings_filename, function (data) {
    this.pendingGreetings = data;
    this.emit('pendingGreetingsLoaded', Object.keys(this.greetings).length);
  }.bind(this), nop);
};

Bot.prototype.writeGreetings = function () {
  imports.Store.write(
    this.config.greetings_filename, 
    this.greetings, 
    console.log.bind(this, 'saved %d greetings to %s', Object.keys(this.greetings).length, this.config.greetings_filename)
  );
};

Bot.prototype.writePendingGreetings = function () {
  imports.Store.write(
    this.config.pending_greetings_filename, 
    this.pendingGreetings, 
    console.log.bind(this, 'saved %d pending greetings to %s', Object.keys(this.pendingGreetings).length, this.config.pending_greetings_filename)
  );
};

Bot.prototype.readActivity = function () {
  imports.Store.read(this.config.activity_filename, function (data) {
    this.activity = data;
    console.log('loaded %d activity records', Object.keys(this.activity).length);
  }.bind(this), nop);
};

Bot.prototype.writeActivity = function () {
  if (this.config.activity_filename) {
    imports.Store.write(
      this.config.activity_filename, 
      this.activity, 
      console.log.bind(this, 'Activity data saved to %s', this.config.activity_filename)
    );
  }
};

Bot.prototype.readUsernames = function () {
  imports.Store.read(this.config.usernames_filename, function (data) {
    this.usernamesById = data;
    
    for (var userid in this.usernamesById) {
      this.useridsByName[this.usernamesById[userid]] = userid;
    }
    
    console.log('loaded %d usernames', Object.keys(this.usernamesById).length);
  }.bind(this), nop);
};

Bot.prototype.writeUsernames = function () {
  if (this.config.usernames_filename) {
    imports.Store.write(
      this.config.usernames_filename, 
      this.usernamesById, 
      console.log.bind(this, 'Username map saved to %s', this.config.usernames_filename)
    );
  }
};

/**
 * @param {{name: string, userid: string, text: string}} data return by ttapi
 */
Bot.prototype.onSpeak = function (data) {
  if (this.debug)
    console.dir(data);
  
  if (this.logChats)
    console.log('chat: %s: %s', data.name, data.text);
  
  if (data.command === "pmmed") {
    data.name = this.lookupUsername(data.senderid);
    data.userid = data.senderid;
  }
  
  this.recordActivity(data.userid);
  var words = data.text.split(/\s+/);
  var command = words[0].toLowerCase();
  
  if (command.match(/^[!*\/]/)) {
    command = command.substring(1);
  } else if (data.command === "pmmed") {
    // allow non-prefixed commands in PMs.
  } else if (Bot.bareCommands.indexOf(data.text) === -1) { // bare commands must match the entire text line
    return;
  }
  
  var handler = null;
  if (this.config.owners[data.userid]) {
    handler = handler || this.ownerCommandHandlers[command];
    handler = handler || this.friendCommandHandlers[command];
  }
  
  if (this.config.friends[data.userid]) {
    handler = handler || this.friendCommandHandlers[command];
  }
  
  handler = handler || this.commandHandlers[command];
  handler = handler || this.hiddenCommandHandlers[command];
  
  if (handler) {
    if (data.command === "pmmed") this.replyPm = data.senderid;
    
    handler.call(this, data.text, data.userid, data.name);
    delete this.replyPm;
  }
};

/**
 * TODO: Implement list support
 */
Bot.prototype.onHop = function () {
  if (this.djs.length > 4) {
    this.say("Can't, already filled all the spots there bob.");
    return;
  }

  this.say(this.config.messages.hop);
  this.ttapi.addDj();
  this.djing = true;
};

Bot.prototype.onHopDown = function () {
  if(!this.djing)
    return;
  
  this.say(this.config.messages.hopdown);
  this.ttapi.remDj(this.config.userid);
};

// Silently snag the song.
Bot.prototype.onSnag = function () {
  this.ttapi.snag();
};

// Skip the current song
Bot.prototype.onSkip = function () {
  var dj = this.currentDj(), self = this;
  if(!dj) return;
  
  console.log('current dj: ' + dj.userid);
  console.log(JSON.stringify(this.ttapi, null, 2));
  
  if(dj.userid == this.config.userid)
    this.ttapi.stopSong();
  else
    this.ttapi.playlistAll(function (data) {
      if(data.list.length < 1) return;
      console.log('reordering playlist... it should skip damn it')
      var i = data.list.length - 1;
      return self.ttapi.playlistReorder(0, i);
    });
};

Bot.prototype.onSay = function (text, senderid) {
  console.log('onSay: %s', text);
  this.say(Bot.splitCommand(text)[1]);
};

Bot.prototype.onHelp = function () {
  this.reply(this.config.messages.help);
};

Bot.prototype.onHelpCommands = function () {
  this.reply('commands: ' + Object.keys(this.commandHandlers).map(function (s) {
    return "*" + s;
  }).join(', '));
};

Bot.prototype.onHelpFriendCommands = function () {
  this.reply('friend commands: ' + Object.keys(this.friendCommandHandlers).map(function (s) {
    return "*" + s;
  }).join(', '));
};

Bot.prototype.onOwners = function () {
  this.reply('my owners are: ' + Object.keys(this.config.owners).map(this.lookupUsername.bind(this)).join(', '));
};

Bot.prototype.onFriends = function () {
  this.reply('my friends are: ' + Object.keys(this.config.owners).concat(Object.keys(this.config.friends)).map(this.lookupUsername.bind(this)).join(', '));
};

Bot.prototype.onAutoBop = function () {
  this.autoBopping = true;
  this.autoBop();
};

Bot.prototype.autoBop = function () {
  if (!this.currentSong) return;
  if (this.currentSong.song.djid == this.config.userid) return;
  
  this.ttapi.vote('up', function (cs, data) {
    if (this.debug) console.dir(data);
  });
}

Bot.prototype.onBonus = function (text, userid, username) {
  if (!this.currentSong) return;

  if (this.currentSong.song.djid === userid && !this.config.owners.indexOf(userid)) {
    this.reply(this.config.messages.selfBonus.replace(/\{user\.name\}/g, username));
    return;
  }
  
  if (this.currentSong.bonusBy) {
    this.reply(
      this.config.messages.bonusAlreadyUsed.replace(/\{user.name\}/g, this.lookupUsername(this.currentSong.bonusBy))
    );
    return;
  }
  
  this.currentSong.bonusBy = userid;
  this.ttapi.vote('up', this.bonusCb.bind(this, this.currentSong));
};

Bot.prototype.bonusCb = function (currentSong, data) {
  if (this.debug) console.dir(data);
  if (!data.success) return;
  
  this.say(this.config.messages.bonus.replace(/\{user.name\}/g, this.lookupUsername(currentSong.bonusBy)).replace(/\{dj.name\}/g, currentSong.song.djname));
};

Bot.prototype.onAlbum = function () {
  if (this.currentSong) {
    this.reply(
      this.config.messages.album
      .replace(/\{song\}/g, this.currentSong.song.metadata.song)
      .replace(/\{artist\}/g, this.currentSong.song.metadata.artist)
      .replace(/\{album\}/g, this.currentSong.song.metadata.album || "(unknown)")
    );
  }
};

Bot.prototype.onLast = function (text, unused_userid, unused_username) {
  var subject_name = Bot.splitCommand(text)[1];
  if (!subject_name) {
    this.reply("Usage: " + Bot.splitCommand(text)[0] + " <username>");
    return;
  }
  
  var age_m = this.last(subject_name);
  if (age_m >= 0) {
    var age = age_m + " minutes";
    if (age_m > 120) {
      age = Math.floor(age_m / 60) + " hours";
    }
    this.reply(
    this.config.messages.lastActivity.replace(/\{user\.name\}/g, subject_name).replace(/\{age\}/g, age));
  } else {
    this.reply(
    this.config.messages.lastActivityUnknown.replace(/\{user\.name\}/g, subject_name));
  }
};

Bot.prototype.last = function (username) {
  var userid, last;
  
  userid = this.useridsByName[username];
  if (!userid) return -1;
  
  last = this.activity[userid];
  if (!last) return -1;
  
  var age_ms = Bot.now() - new Date(last);
  var age_m = Math.floor(age_ms / 1000 / 60);
  return age_m;
};

Bot.prototype.last.__doc__ = 'last(username): minutes since last recorded activity by username';

Bot.prototype.lookupUsername = function (userid) {
  return this.usernamesById[userid] || "(unknown)";
};

Bot.prototype.lookupUsernameWithIdleStars = function (userid) {
  var username = this.lookupUsername(userid);
  var age_m = this.last(username);
  
  if (age_m > 4) return username + "*";
  return username;
};

Bot.prototype.onPlays = function (text, userid, username) {
  var dj = this.currentDj();
  if (!dj) return;
  
  var djid = dj.userid;
  var subject_name = Bot.splitCommand(text)[1];
  if (subject_name) {
    djid = this.useridsByName[subject_name];
    if (!djid) {
      this.reply(
      this.config.messages.unknownUser.replace(/\{user.name\}/g, subject_name));
      return;
    }
  }
  
  var stats = this.djs[djid];
  if (stats) {
    this.reply(
    this.config.messages.plays.replace(/\{user\.name\}/g, stats.user.name).replace(/\{plays\}/g, stats.plays));
  }
};

Bot.prototype.onList = function (text, userid, username) {
  if (!this.djList.active) {
    this.reply(this.config.messages.listInactive);
    return;
  }
  
  if (this.djList.length()) {
    var number = (function () {
      var i = 0;
      return function (item) {
        return ':' + (++i) + ': ' + item;
      };
    }());
    this.reply(this.config.messages.list.replace(/\{list\}/g, this.djList.list.map(this.lookupUsernameWithIdleStars.bind(this)).map(number).join(', ')));
  } else {
    this.reply(this.config.messages.listEmpty);
  }
};

Bot.prototype.onListOn = function (text, userid, username) {
  if (this.djList.active) {
    this.reply(this.config.messages.listAlreadyOn);
  } else {
    this.djList.active = true;
    this.djList.save(this.config.djlist_filename);
    this.say(this.config.messages.listOn);
  }
};

Bot.prototype.onListOff = function (text, userid, username) {
  if (this.djList.active) {
    this.djList.active = false;
    this.djList.save(this.config.djlist_filename);
    this.say(this.config.messages.listOff);
  } else {
    this.reply(this.config.messages.listAlreadyOff);
  }
};

Bot.prototype.onListReset = function (text, userid, username) {
  if (this.djList) {
    this.djList.list = [];
    this.djList.save(this.config.djlist_filename);
    this.say(this.config.messages.listReset);
  }
};

Bot.prototype.onAddme = function (text, userid, username) {
  if (!this.djList.active) {
    this.reply(this.config.messages.listInactive);
    return;
  }
  
  var position = this.djList.add(userid);
  if (position < 0) {
    this.reply(this.config.messages.listAlreadyListed.replace(/\{user.name\}/g, username).replace(/\{position\}/g, -position));
    return;
  }
  
  this.djList.save(this.config.djlist_filename);
  this.reply(this.config.messages.listAdded.replace(/\{user.name\}/g, username).replace(/\{position\}/g, position));
};

Bot.prototype.onAddFirst = function (text, userid, username) {
  if (!this.djList.active) {
    this.reply(this.config.messages.listInactive);
    return;
  }
  
  var subject_name = Bot.splitCommand(text)[1];
  if (!subject_name) {
    this.reply("Usage: " + Bot.splitCommand(text)[0] + " <username>");
    return;
  }
  
  var subjectid = this.useridsByName[subject_name];
  if (subjectid) {
    this.djList.addFirst(subjectid);
    this.djList.save(this.config.djlist_filename);
    this.say(this.config.messages.listAdded.replace(/\{user.name\}/g, subject_name).replace(/\{position\}/g, 1));
  } else {
    this.reply(this.config.messages.unknownUser.replace(/\{user.name\}/g, subject_name));
  }
};

Bot.prototype.onRemoveme = function (text, userid, username) {
  var i = this.djList.remove(userid);
  
  if (i !== -1) {
    this.djList.save(this.config.djlist_filename);
    this.say(this.config.messages.listRemoved.replace(/\{user.name\}/g, username).replace(/\{position\}/g, i + 1));
  } else {
    this.reply(this.config.messages.listRemoveNotListed.replace(/\{user.name\}/g, username));
  }
};

Bot.prototype.onRemove = function (text, userid, username) {
  var subject_name = Bot.splitCommand(text)[1];
  if (!subject_name) {
    this.reply("Usage: " + Bot.splitCommand(text)[0] + " <username>");
    return;
  }
  var subjectid = this.useridsByName[subject_name];
  this.onRemoveme(text, subjectid, subject_name);
};

Bot.prototype.onRemoveFirst = function (text, userid, username) {
  var removed_userid = this.djList.removeFirst();
  if (removed_userid) {
    this.say(this.config.messages.listRemoved.replace(/\{user\.name\}/g, this.lookupUsername(removed_userid)).replace(/\{position\}/g, 1));
  } else {
    this.reply(this.config.messages.listEmpty);
  }
};

Bot.prototype.onKick = function (text, userid, username) {
  var args = Bot.splitCommand(text)[1];
  if (!args) {
    this.reply("Usage: " + Bot.splitCommand(text)[0] + " <username>, <reason>");
    return;
  }
  var split = args.split(/,(.+)/);
  var subject_name = split[0];
  var reason = split[1] ? username + ": " + split[1] : "by " + username;
  var subjectid = this.useridsByName[subject_name];
  if (!subjectid) {
    return;
  }
  this.ttapi.bootUser(subjectid, reason);
};

Bot.prototype.onBan = function (text, userid, username) {
  var args = Bot.splitCommand(text)[1];
  if (!args) {
    this.reply("Usage: " + Bot.splitCommand(text)[0] + " <username>, <comment>");
    return;
  }
  
  var split = args.split(/,(.+)/);
  var subject_name = split[0];
  var comment = split[1] || "";
  var subjectid = this.useridsByName[subject_name];

  if (!subjectid) return;
  else if (subjectid == this.config.userid) {
    this.say("I won't ban myself, dummy.");
    return;
  }

  this.banList.ban(subjectid, comment + " -- " + username + " " + Bot.now());
  this.banList.save(this.config.banlist_filename);
  this.say(this.config.messages.ban.replace(/\{user\.name\}/g, subject_name).replace(/\{banner\.name\}/g, username).replace(/\{ban\.comment\}/g, comment));
};

Bot.prototype.onBans = function (text, userid, username) {
  var bans = this.banList.list();
  this.reply(this.config.messages.bans.replace(/\{ban\.count\}/g, Object.keys(bans).length).replace(/\{ban\.list\}/g, bans.map(this.lookupUsername.bind(this)).join(', ')));
};

Bot.prototype.onBanned = function (text, userid, username) {
  var subject_name = Bot.splitCommand(text)[1];
  
  if (!subject_name) {
    this.reply("Usage: " + Bot.splitCommand(text)[0] + " <username>");
    return;
  }
  
  var subjectid = this.useridsByName[subject_name];
  var comment = this.banList.query(subjectid);
  
  if (!comment)
    this.reply(this.config.messages.notBanned.replace(/\{user\.name\}/g, subject_name));
  else
    this.reply(this.config.messages.banned.replace(/\{user\.name\}/g, subject_name).replace(/\{ban\.comment\}/g, comment));
};

Bot.prototype.onUnban = function (text, userid, username) {
  var subject_name = Bot.splitCommand(text)[1];
  if (!subject_name) {
    this.reply("Usage: " + Bot.splitCommand(text)[0] + " <username>");
    return;
  }
  
  var subjectid = this.useridsByName[subject_name];
  var comment = this.banList.query(subjectid);
  
  if (!comment) {
    this.reply(this.config.messages.notBanned.replace(/\{user\.name\}/g, subject_name));
  } else {
    this.banList.unban(subjectid);
    this.banList.save(this.config.banlist_filename);
    this.say(this.config.messages.unbanned.replace(/\{user\.name\}/g, subject_name));
  }
};

Bot.prototype.onGreet = function (text, userid, username) {
  var greeting = Bot.splitCommand(text)[1];
  
  if (!greeting || greeting.indexOf(username) === -1) {
    this.reply("Usage: " + Bot.splitCommand(text)[0] + " <greeting> -- greeting must contain your name.");
    return;
  }
  
  this.pendingGreetings[userid] = greeting.replace(username, "{user.name}");
  this.writePendingGreetings();
  this.reply("(pending approval): " + greeting.replace(/\{user.name\}/g, username));
};

Bot.prototype.onApproveGreeting = function (text, userid, username) {
  var subject_name = Bot.splitCommand(text)[1];
  
  if (!subject_name) {
    this.reply("Usage: " + Bot.splitCommand(text)[0] + " <username>");
    return;
  }
  
  var subjectid = this.useridsByName[subject_name];
  if (subjectid && this.pendingGreetings[subjectid]) {
    this.greetings[subjectid] = this.pendingGreetings[subjectid];
    delete this.pendingGreetings[subjectid];
    this.writeGreetings();
    this.writePendingGreetings();
    this.say(this.greeting({
      name: subject_name,
      userid: subjectid
    }));
  }
};

Bot.prototype.onShowGreeting = function (text, userid, username) {
  var subject_name = Bot.splitCommand(text)[1];
  if (!subject_name) {
    this.reply("Usage: " + Bot.splitCommand(text)[0] + " <username>");
    return;
  }
  
  var subjectid = this.useridsByName[subject_name];
  if (!subjectid) return;
  
  if (this.pendingGreetings[subjectid]) {
    this.reply("(pending approval): " + this.pendingGreetings[subjectid].replace(/\{user.name\}/g, subject_name));
  } else if (this.greetings[subjectid]) {
    this.reply("(approved): " + this.greetings[subjectid].replace(/\{user.name\}/g, subject_name));
  }
};

Bot.prototype.onRejectGreeting = function (text, userid, username) {
  var subject_name = Bot.splitCommand(text)[1];
  if (!subject_name) {
    this.reply("Usage: " + Bot.splitCommand(text)[0] + " <username>");
    return;
  }
  var subjectid = this.useridsByName[subject_name];
  if (!subjectid) {
    return;
  }
  if (subjectid in this.pendingGreetings) {
    delete this.pendingGreetings[subjectid];
    this.writePendingGreetings();
    this.reply(this.config.messages.pendingGreetingRejected.replace(/\{user.name\}/g, subject_name));
  } else if (subjectid in this.greetings) {
    delete this.greetings[subjectid];
    this.writeGreetings();
    this.reply(this.config.messages.greetingRejected.replace(/\{user.name\}/g, subject_name));
  } else {
    this.reply(this.config.messages.noGreeting.replace(/\{user.name\}/g, subject_name));
  }
};

Bot.prototype.onPendingGreetings = function (text, userid, username) {
  this.reply(this.config.messages.pendingGreetings.replace(/\{list\}/, Object.keys(this.pendingGreetings).map(this.lookupUsername.bind(this)).join(', ')));
};

Bot.prototype.onRegistered = function (data) {
  if (this.muteGreetings) return;
  if (this.debug) console.dir(data);
  
  var user = data.user[0];
  if (user.userid !== this.config.userid) {
    this.recordActivity(user.userid);
    this.refreshRoomInfo();
    if (this.banList) {
      var ban_comment = this.banList.query(user.userid);
      if (ban_comment) {
        this.say(this.config.messages.banned.replace(/\{user\.name\}/g, user.name).replace(/\{ban\.comment\}/g, ban_comment));
        this.ttapi.bootUser(user.userid, ban_comment);
        return;
      }
    }
    this.say(this.greeting(user));
  }
};

Bot.prototype.onRegisteredFan = function (data) {
  var user = data.user[0];
  if (user.userid !== this.config.userid) {
    this.ttapi.becomeFan(user.userid);
  }
};

Bot.prototype.greeting = function (user) {
  var message = this.greetings[user.userid];
  var now = Bot.now();
  var aWeekAgo = Bot.now().setDate(now.getDate() - 7);
  if (!message && (new Date(MS_FROM_S * user.created) > aWeekAgo)) {
    message = randomElement(this.config.messages.newUserGreetings);
  }
  if (!message) {
    message = randomElement(this.config.messages.defaultGreetings);
  }
  return message.replace(/\{user\.name\}/g, user.name);
};

Bot.prototype.djAnnouncement = function (user) {
  var message;
  if (user.points === 0) {
    message = randomElement(this.config.messages.newDjAnnouncements);
  } else {
    message = randomElement(this.config.messages.djAnnouncements);
  }
  return message.replace(/\{user\.name\}/g, user.name).replace(/\{user\.points\}/g, user.points).replace(/\{user\.fans\}/g, user.fans);
};


Bot.prototype.onRoomInfo = function (data) {
  if (this.debug) console.dir(data);

  this.roomInfo = data;
  this.users = {};
  
  if (data.success) {
    this.roomInfo.users.forEach(function (user) {
      this.users[user.userid] = user;
      this.useridsByName[user.name] = user.userid;
      this.usernamesById[user.userid] = user.name;
    }, this);
    this.writeUsernames();
    if (!this.currentSong && data.room.metadata.current_song) {
      this.onNewSong(data);
      this.currentSong.updateVotes(data.room.metadata);
    }
  }
};

Bot.prototype.currentDj = function (optional_roomInfo) {
  var roomInfo = optional_roomInfo || this.roomInfo;
  return this.users[roomInfo.room.metadata.current_dj];
};

/** @param {RoomInfo} data */
Bot.prototype.initBanList = function (data) {
  this.banList = null;
  
  if (data.success) {
    BanList.fromFile(this.config.banlist_filename, data.room.roomid, function (banList) {
      this.banList = banList;
    }.bind(this));
  }
};

/** @param {RoomInfo} data */
Bot.prototype.initDjList = function (data) {
  if (data.success) {
    DjList.fromFile(this.config.djlist_filename, data.room.roomid, function (djList) {
      this.djList = djList;
    }.bind(this));
  } else {
    this.djList = new DjList();
  }
};

Bot.prototype.refreshRoomInfo = function (cb) {
  this.ttapi.roomInfo(function (data) {
    this.onRoomInfo.call(this, data);
    if (cb) cb.call(this, data);
  }.bind(this));
};

Bot.prototype.onDeregister = function (data) {
  if (this.debug) console.dir(data);
  
  if (data.userid === this.config.userid) {
    this.roomInfo = null;
    this.users = {};
  } else {
    this.recordActivity(data.userid);
    this.refreshRoomInfo();
  }
};

Bot.prototype.say = function (msg, pmUser) {
  if (!msg || !this.roomInfo) return;

  var message = msg.replace(/\{room\.name\}/g, this.roomInfo.room.name).replace(/\{bot\.name\}/g, this.lookupUsername(this.config.userid));
  
  if (this.debug) console.log("say(" + pmUser + "): %s", message);
  if (!this.mute) {
    if (pmUser) {
      this.ttapi.pm(message, pmUser);
    } else {
      this.ttapi.speak(message);
    }
  }
};

Bot.prototype.reply = function (msg) {
  this.say(msg, this.replyPm);
};

Bot.prototype.onNewModerator = function (data) {
  if (this.debug) console.dir(data);
  this.say(this.config.messages.newModerator.replace(/\{user\.name\}/g, this.lookupUsername(data.userid)));
};

Bot.prototype.onAddDj = function (data) {
  if (this.debug) console.dir(data);
  
  var user = data.user[0];
  this.recordActivity(user.userid);
  this.djs[user.userid] = new imports.stats.DjStats(user);
  
  if (this.djList.active) {
    var next = this.djList.next();
    if (next) {
      if (user.userid === next) {
        this.djList.remove(user.userid);
      } else {
        this.say(this.config.messages.wrongDj.replace(/\{right.name\}/g, this.lookupUsername(next)).replace(/\{wrong.name\}/g, user.name));
        return;
      }
    }
  }
  this.say(this.djAnnouncement(user));
};

Bot.prototype.djSummary = function (stats) {
  var message = randomElement(this.config.messages.djSummaries);
  return message.replace(/\{user\.name\}/g, stats.user.name).replace(/\{user\.points\}/g, stats.user.points).replace(/\{lames\}/g, stats.lames).replace(/\{gain\}/g, stats.gain).replace(/\{plays\}/g, stats.plays);
};

Bot.prototype.onRemDj = function (data) {
  if (this.debug) console.dir(data);
  
  var user = data.user[0];
  this.recordActivity(user.userid);
  var stats = this.djs[user.userid];
  
  if (stats) {
    stats.update(user);
    delete this.djs[user.userid];
    this.say(this.djSummary(stats));
  }
  
  if (this.djList.active) {
    var next = this.djList.next();
    if (next) {
      this.say(this.config.messages.nextDj.replace(/\{user.name\}/, this.lookupUsername(next)));
    }
  }
};

Bot.prototype.onSnagged = function (data) {
  if (this.debug) console.dir(data);
  
  this.recordActivity(data.userid);
};

Bot.prototype.onNewSong = function (data) {
  var self = this;
  
  if (this.debug) console.dir(data);
  if (this.autoBopping) setTimeout(function () { 
    self.autoBop();
  }, 1500);
  
  var song = data.room.metadata.current_song;
  var userid = data.room.metadata.current_dj;
  var djstats = this.djs[userid] || (this.djs[userid] = new imports.stats.DjStats(this.users[userid]));
  djstats.play(song);
  this.currentSong = new imports.stats.SongStats(song);
};

Bot.prototype.onEndSong = function () {
  if (this.currentSong) {
    var message = this.config.messages.songSummary;
    this.say(message.replace(/\{user\.name\}/g, this.currentSong.song.djname).replace(/\{awesomes\}/g, isNaN(this.currentSong.votes.upvotes) ? 0 : this.currentSong.votes.upvotes).replace(/\{lames\}/g, isNaN(this.currentSong.votes.downvotes) ? 0 : this.currentSong.votes.downvotes).replace(/\{song\}/g, this.currentSong.song.metadata.song).replace(/\{artist\}/g, this.currentSong.song.metadata.artist).replace(/\{album\}/g, this.currentSong.song.metadata.album));
  }
  
  this.currentSong = null;
};

Bot.prototype.milestoneMessage = function (points) {
  var message = this.config.messages.milestones[points];
  
  if (points % 1000 === 0) {
    message = message || this.config.messages.milestones['thousand'];
  }
  
  if (points % 100 === 0) {
    message = message || this.config.messages.milestones['hundred'];
  }
  return message;
};

Bot.prototype.checkMilestone = function () {
  var dj = this.currentDj();
  if (!dj) return;
  
  var points = dj.points;
  var message = this.milestoneMessage(points);
  if (message) {
    this.say(message.replace(/\{user\.name\}/g, dj.name).replace(/\{points\}/g, points));
  }
};

Bot.prototype.onUpdateVotes = function (data) {
  if (this.debug) console.dir(data);
  
  this.recordActivity(data.room.metadata.votelog[0][0]);
  
  if (this.currentSong) {
    this.currentSong.updateVotes(data.room.metadata);
  }
  
  this.refreshRoomInfo(this.checkMilestone);
};

Bot.prototype.onNoSong = function (data) {
  if (this.debug) console.dir(data);
  this.currentSong = null;
};

Bot.bareCommands = [
  'help',
  'list',
  'addme',
  'removeme'
];

Bot.prototype.recordActivity = function (userid) {
  if (userid === this.config.userid) return;
  this.activity[userid] = Bot.now();
  this.writeActivity();
};

Bot.now = function () {
  return new Date();
};

exports.Bot = Bot;
exports.imports = imports;

if (!module.parent) {
  if (process.argv.length > 2) {
    var bot = new Bot(process.argv[2]);
    var factbot = new imports.FactBot(bot);
    factbot.start();
  } else {
    process.stderr.write(Bot.usage());
    process.exit(1);
  }
}