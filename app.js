var expressValidator = require('express-validator');
var expressSession = require('express-session');
var bodyParser = require('body-parser');
var routes = require('./routes/index');
var favicon = require('serve-favicon')
var game_api = require('./game_api');
var express = require('express');
var config = require('./config');
var router = express.Router();  
var path = require('path');
var app = express();
var { User, Robot } = require('./database');
var loopLimit = 0;

var server = require('http').Server(app);
var io = require('socket.io')(server);

// Setting up static path for css, js and images.
app.use(express.static(path.join(__dirname + "/public")));

// Setting up view engine.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(favicon(path.join(__dirname, '/public/favicon.ico')));

// HTTP Headers.
app.use(function(req, res, next){
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});
 
// User session.
app.use(expressSession({
    secret: config.dev.session.key,    
    cookie: {
        maxAge: config.dev.session.age
    },
    saveUninitialized: false, 
    resave: false
}));

// Using routes middleware.
app.use('/', routes);

// Creating NodeJS server.
server.listen(config.dev.server.port, () => console.log('Server runnning'));

/* -- SocketIO setup -- */
var gameCollection = new function(){
    this.totalGameCount = 0;
    this.gameList = []
};

function gameSeeker(socket){
    loopLimit++;
    if((gameCollection.totalGameCount == 0) || (loopLimit >= 20)){
        buildGame(socket);
        loopLimit = 0;
    } else {
        var randomPick = Math.floor(Math.random() * gameCollection.totalGameCount);
        
        if(gameCollection.gameList[randomPick]['gameObject']['playerTwo'] == null){
            gameCollection.gameList[randomPick]['gameObject']['playerTwo'] = socket.username;

            socket.emit('joinSuccess', {
                gameId:     gameCollection.gameList[randomPick]['gameObject']['id'],
                username:   gameCollection.gameList[randomPick]['gameObject']['playerTwo'],
                host:       gameCollection.gameList[randomPick]['gameObject']['playerOne']
            });

            io.emit('gameReady', {
                data: gameCollection.gameList[randomPick]['gameObject']
            });
        } 
        else {
            gameSeeker(socket);
        }
    }
}

function buildGame(socket){
    var gameObject = {};
    gameObject.id = (Math.random() + 1).toString(36).slice(2, 18);
    gameObject.playerOne = socket.username;
    gameObject.playerTwo = null;
    gameCollection.totalGameCount++;
    gameCollection.gameList.push({gameObject});

    io.emit('gameCreated', gameCollection.gameList);
}

function destroyGame(socket){
    var notInGame = true;

    for(var i = 0; i < gameCollection.totalGameCount; i++){
        var gameId = gameCollection.gameList[i]['gameObject']['id'];
        var p1 = gameCollection.gameList[i]['gameObject']['playerOne'];
        var p2 = gameCollection.gameList[i]['gameObject']['playerTwo'];

        if(p1 === socket.username){
            gameCollection.totalGameCount--;
            gameCollection.gameList.splice(i, 1);
            socket.emit('leftGame', { gameId: gameId} );
            io.emit('gameDestroyed', { gameId: gameId, gameOwner: socket.username });
            notInGame = false;
        } 
        else if(p2 === socket.username){
            gameCollection.gameList[i]['gameObject']['playerTwo'] = null;
            socket.emit('leftGame', { gameId: gameId });
            notInGame = false;
        }
    }

    if(notInGame === true)
        socket.emit('notInGame');
}

var playersCount = 0;

io.on('connection', function(socket){

    /**
     * Game session data of game player is currently in.
     */
    var sessionObj = {
        index: '',
        gameId: '',
        priority: ''
    }

    /**
     * Initial player object.
     * Each instance for each player.
     */
    let player = {
        name: '',
        posX: 50,
        posY: 50,
        rotation: 0,
        health: 100,
        energy: 100,
        experience: 0,
        priority: '',
        level: 1,
        rotating: false,
        moving: false,
        turret: {
            rotation: 0,
            rotating: false
        }
    }

    /**
     * 1. AJAX call sends post.
     * 2. Server returns robot data.
     * 3. Client side receives data. Sends same data through socket event.
     * 4. Server receives data and sets player properties.
     * REASON: Cannot return data from route directly to socket connection.
     */
    /**
     * Gets selected robot from database.
     */
    app.use('/', router.post('/getRobotData', function(req, res){
        User.findOne({
            attributes: ['userId'],
            where: { username: req.session.username }
        }).then((user) => {
            Robot.findOne({
                where: { userId: user.userId,
                         name: req.body.robotname },
                attributes: ['name', 'health', 'energy', 'level', 'experience', 'code']
            }).then((robot) => {
                res.send({ robot });
            });
        });
    }));

    /**
     * Set player object properties on socket connection.
     */
    socket.on('initiate player', (data) => {
        game_api.setPlayerData(data.robot, player);
    });

    /**
     * SocketIO events received form client-side.
     */
    socket.on('move forward', (data) => {
        game_api.moveForward(data, player); 
        socket.emit('update', player);                  // Send to client.
        socket.broadcast.emit('enemy update', player);  // Send to enemy client.
    });

    socket.on('move back', (data) => {
        game_api.moveBack(data, player); 
        socket.emit('update', player);                  // Send to client.
        socket.broadcast.emit('enemy update', player);  // Send to enemy client.
    });

    socket.on('rotate bot', (data) => {
        game_api.rotate(data, player);
        console.log(player.rotation);
        socket.emit('update', player);
    });

    var userAdded = false;

    socket.on('add user', function(username){
        if(userAdded)
            return;

        socket.username = username;
        playersCount++;
        userAdded = true;

        socket.emit('login', { playersCount: playersCount });

        socket.broadcast.emit('player joined', {
            username: socket.username,
            playersCount: playersCount
        });
    });

    socket.on('disconnect', function(){
        if(userAdded){
            playersCount--;
            destroyGame(socket);

            socket.broadcast.emit('player left', {
                username: socket.username,
                playersCount: playersCount
            });
        }

        game_api.resetPlayerData(player);
    });

    socket.on('joinGame', function(){
        var alreadyInGame = false;
        
        for(var i = 0; i < gameCollection.totalGameCount; i++){
            var p1 = gameCollection.gameList[i]['gameObject']['playerOne'];
            var p2 = gameCollection.gameList[i]['gameObject']['playerTwo'];

            if (p1 === socket.username || p2 === socket.username){
                alreadyInGame = true;

                socket.emit('alreadyJoined', {
                    gameId: gameCollection.gameList[i]['gameObject']['id']
                });
            }
        }

        if(alreadyInGame == false){
            gameSeeker(socket);
        }
    });

    socket.on('beginGame', (data) => {
        for(var i = 0; i < gameCollection.gameList.length; i++){
            var p1 = gameCollection.gameList[i]['gameObject']['playerOne'];
            var p2 = gameCollection.gameList[i]['gameObject']['playerTwo'];

            /* Getting reference to game session. */
            if(p1 === socket.username || p2 === socket.username){
                sessionObj.index = i;
                sessionObj.gameId = gameCollection.gameList[i]['gameObject']['id'];

                if(p1 === socket.username)
                    sessionObj.priority = 'playerOne';
                else sessionObj.priority = 'playerTwo';
            }
        }

        if(sessionObj.priority === 'playerTwo'){
            player.posX = 150;
            player.posY = 150;
        }
        
        player.priority = sessionObj.priority;
    });

    /**
     * Client requesting for all mp games created.
     * Sending game list.
     */
    socket.on('getCreatedGames', function(){
        socket.emit('createdGamesList', gameCollection.gameList);
    });

    socket.on('leaveGame', function(){
        if(gameCollection.totalGameCount == 0){
            socket.emit('notInGame');
        } else{
            destroyGame(socket);
        }
    });
});

function getPlayer(index, playerPriority){
    return gameCollection.gameList[index]['gameObject'][playerPriority];
}

module.exports = app;