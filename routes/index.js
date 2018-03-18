var authentication = require('./auth_routes');
var express = require('express');
var router = express.Router();

// GET requests.
// Routes should be split into their related files.
router.get('/', function(req, res){
    res.render('index.ejs', {name: req.session.username});      
});

router.get('/login', function(req, res){
    if(!req.session.username){                                         // Render only if not logged in
        res.render('./user/login.ejs', {name: req.session.username});  // Passing session data.
    }
    else{
        res.redirect('/');
    }          
});

router.get('/register', function(req, res){
    if(!req.session.username){  
        res.render('./user/register.ejs');
        req.session.success = null;
    }
    else{
        res.redirect('/');
    }
});

router.get('/rankings', function(req, res){
    renderIfLogged('./game_info/rankings.ejs', req, res);
});

router.get('/practice', function(req, res){
    renderIfLogged('./play/practice.ejs', req, res);
});

router.get('/compete', function(req, res){
    renderIfLogged('./play/compete.ejs', req, res);
});

router.get('/dashboard', function(req, res){
    renderIfLogged('./game_info/dashboard.ejs', req, res);
});

router.get('/settings', function(req, res){
    renderIfLogged('./user/settings.ejs', req, res);
});

router.get('/recovery', function(req, res){
    res.render('./user/recovery.ejs', {name: req.session.username});        
});

/**
 * Routes to handle user registration and login.
 */
router.post('/register', authentication.register);
router.post('/login', authentication.login);

/**
 * Destroys user session on GET request to logout.ejs.
 */
router.get('/logout', function(req, res){
    console.log('User session destroyed.')
    req.session.destroy();
    res.redirect('/');
});

/**
 * Renders given page if user is logged in.
 * Redirects to home page otherwise.
 * @param { Page to render if user is logged in. } route 
 */
function renderIfLogged(route, req, res){
    if(req.session.username)
        res.render(route, {name: req.session.username});
    else 
        res.redirect('/');
}

module.exports = router;
