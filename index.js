require('dotenv').config()

const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const mysql = require('mysql');

app.use( bodyParser.json() );      
app.use(bodyParser.urlencoded({     
  extended: true
}));


// this code establishes the correct type of database connection based on whether we're in
// a development or production environment.
let pool;
if (process.env.NODE_ENV === 'development') {
    // do dev stuff
    pool = require('./database');
} 
if (process.env.NODE_ENV === 'production') {
    //do production stuff
    const createPool = async () => {
        pool = await mysql.createPool({
          user: process.env.DB_USER, // e.g. 'my-db-user'
          password: process.env.DB_PASS, // e.g. 'my-db-password'
          database: process.env.DB_NAME, // e.g. 'my-database'
          // If connecting via unix domain socket, specify the path
          socketPath: `/cloudsql/${process.env.DB_INSTANCE_NAME}`,
          // If connecting via TCP, enter the IP and port instead
          // host: 'localhost',
          // port: 3306,
      
          //...
        });
    };
    createPool();
}


// yes, this is a global table of module id's to module titles 
var moduleTitles = {};


var findModule = function (module_name, callback, uid) {
    pool.query(
        "SELECT * FROM `module_data` where parent_module = ?", [module_name, uid],
        function(error, results, fields) {
          if (error) return error;
          return callback(null, results);
        }
    ); 
};

var indexLetterEntry = function (letter, callback, uid) {
    pool.query(
        "SELECT * FROM `glossary` WHERE term LIKE CONCAT(?, '%') ORDER BY term;", [letter, uid],
        function(error, results, fields) {
          if (error) { return error;}
          return callback(null, results);
        }
    ); 
};

var searchModules = function (term, callback, uid) {
    pool.query(
        "SELECT * FROM `modules` WHERE module_title LIKE CONCAT('%', ?, '%') OR module_desc LIKE CONCAT('%', ?, '%');", 
        [term, term, uid],
        function(error, results, fields) {
          if (error) { return error;}
          return callback(null, results);
        }
    ); 
}

var searchModuleData = function (term, callback, uid) {
    pool.query(
        "SELECT * FROM `module_data` WHERE content LIKE CONCAT('%', ?, '%') OR text LIKE CONCAT('%', ?, '%');",
        [term, term, uid],
        function(error, results, fields) {
          if (error) { return error;}
          return callback(null, results);
        }
    );
}

var searchIndex = function (term, callback, uid) {
    pool.query(
        "SELECT * FROM `glossary` WHERE term LIKE CONCAT('%', ?, '%') OR definition LIKE CONCAT('%', ?, '%');",
        [term, term, uid],
        function(error, results, fields) {
            if (error) { return error;}
            return callback(null, results);
        }
    );
}

var sanitizeSearchTerm = function (term) {
    // these characters continue to cause problems
    return term.replace(/[_?%]/g, "").toLowerCase();
}

var getSurroundingText = function (term, text) {
    if (term == null || text == null) return '';

    const margin = 40;
 
    let term_pos = text.toLowerCase().indexOf(term);

    let start_pos = Math.max(term_pos - margin, 0);
    let end_pos = Math.min(term_pos + term.length + margin, text.length);

    let start_elipses = start_pos > 0 ? "..." : "";
    let end_elipses = end_pos < text.length ? "..." : "";
    
    return `${start_elipses}${text.substring(start_pos, end_pos)}${end_elipses}`;
}

// Takes list of db responses and converts them to a unified javascript object format
var prepareSearchResults = function (term, raw_results, uid) {
    
    for( i = 0; i < raw_results.length; i++) {
        // convert result from RowDataPacket to standard Javascript object
        let raw_result = Object.assign({}, raw_results[i]);
        raw_results[i] = {
            route : "",
            param : "",
            text  : "",
            name  : ""
        };
        
        var sample_text = "";
        if(raw_result.hasOwnProperty('module_id')){
            raw_results[i].route = "ModuleScreen";
            raw_results[i].param = raw_result.module_id;
            raw_results[i].name = raw_result.module_title;

            if (raw_result.module_desc.toLowerCase().includes(term)) {
                sample_text = raw_result.module_desc;
            }
            else {
                sample_text = raw_result.module_title;
            }

        }
        else if(raw_result.hasOwnProperty('index_id')) {
            raw_results[i].route = "IndexScreen";
            raw_results[i].param = raw_result.index_id;
            raw_results[i].name = raw_result.term;

            if( raw_result.definition.toLowerCase().includes(term)) {
                sample_text = raw_result.definition;
            }
            else {
                sample_text = raw_result.term;
            }

        }
        else {
            raw_results[i].route = "ModuleScreen";
            raw_results[i].param = raw_result.parent_module;
            raw_results[i].name = moduleTitles[raw_result.parent_module];


            if(raw_result.content_type == "text" || raw_result.content_type == "list") {
                sample_text = raw_result.text;
            }
            else if (raw_result.content_type == "quiz") {
                sample_text = `${raw_result.content} ${raw_result.text}`;
            }
            else {
                sample_text = raw_result.content;
            }
        }
        raw_results[i].text = getSurroundingText(term, sample_text);
        
    }


    return raw_results;
}

// helper function for the search API call
var performSearch = function (term, callback, uid, include_modules, include_index) {
    let search_results = [];
    term = sanitizeSearchTerm(term);

    if(term.replace(" ", "") === "") {
        return callback(null, []);
    }

    // this is like the worst way ever to do this. 
    var dummyCallBackExecutor = function(term, callback, uid){
        return callback(null, []);
    }

    var q1 = include_modules ? searchModules : dummyCallBackExecutor;
    var q2 = include_modules ? searchModuleData : dummyCallBackExecutor;
    var q3 = include_index   ? searchIndex : dummyCallBackExecutor;


    pool.query(
        "SELECT * FROM `modules`;", uid,
        function(error, results, fields) {
            if (error) throw error;
            
            for( i = 0; i < results.length; i++) {
                moduleTitles[results[i].module_id] = results[i].module_title;
            }
          
            q1(term, function(error, results) {
                if(error) {return error;}
        
                search_results = search_results.concat(results);
                q2(term, function(error, results) {
                    if(error) {return error;}
        
                    search_results = search_results.concat(results);
                    q3(term, function(error, results) {
                        if(error) {return error;}
        
                        search_results = search_results.concat(results);
                        return callback(null, prepareSearchResults(term, search_results, uid));
                    }, uid);
                }, uid);
            }, uid);
        }
      );
}

// gets the titles and descriptions of all modules
app.get("/api/modules", (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', true);

    pool.query(
        "SELECT * FROM `modules`;", req.params.userId,
        function(error, results, fields) {
          if (error) throw error;
          res.json(results);
        }
      );
});

// gets the module data associated with module_id
app.get("/api/modules/:module_id", (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', true);
    
    var module_id = req.params.module_id;
    findModule(module_id, function(error, mod) {
        if (error) return next(error);
        return res.json(mod);
      }, req.params.userId);
});

// gets the index of terms
app.get("/api/index", (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', true);

    const letters = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"]
    let response = [];
    let id = 0;

    // very hacky way of doing this
    var itemsProcessed = 0;

    letters.forEach(elem => {
        indexLetterEntry(elem, function(error, mod) {

            // don't make an entry for empty responses
            if (mod && mod.length) {
                response.push({
                    letter : elem,
                    terms  : mod,
                    key : id
                });
                id += 1;
            }
            
            // this is how we avoid the response from returning too early
            itemsProcessed += 1;
            if (itemsProcessed === letters.length) {
                // because each letter is handled by a different thread, we sort the response first
                // the weird lambda ternary gobbledygook is a comparator function
                res.json(response.sort((a, b) => (a.letter > b.letter) ? 1 : -1));
            }
        }, req.params.userId);
    });
    
});

// performs a search query on multiple tables using a search term and some query parameters
app.get("/api/search/:search_term", (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', true);
    
    var search_term = req.params.search_term;

    var include_modules = req.query.mod == 'f' ? false : true;
    var include_index = req.query.ind == 'f' ? false : true;

    // do search function call that queries database
    performSearch(search_term, function(error, results){
        if (error) return next(error);
        return res.json(results)
    }, req.params.userId, include_modules, include_index)
});


const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});
