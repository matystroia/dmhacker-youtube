var express = require('express');
var fs = require('fs');
var path = require('path');
var ytdl = require('ytdl-core');
var ytsearch = require('youtube-search');
var ffmpeg = require('fluent-ffmpeg');

var app = express();

var mkdirs = ['./public/site', './tmp'];
for (var i in mkdirs) {
  var dir = mkdirs[i];
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
}

app.set('port', (process.env.OPENSHIFT_NODEJS_PORT || 5000));

app.use(express.static(__dirname + '/public'));

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.get('/', function(request, response) {
  response.render('index');
});

//////////////////////////// ALEXA ROUTES ////////////////////////////

var cache = {};

app.get('/alexa-search/:query', function(req, res) {
  var query = new Buffer(req.params.query, 'base64').toString();
  var lang = req.query.language || 'en';
  if (lang !== 'en' || lang !== 'de') {
    lang = 'en';
  }
  console.log('Query from ' + req.connection.remoteAddress + ': '+query);
  ytsearch(query, {
    maxResults: 1,
    type: 'video',
    relevanceLanguage: lang,
    key: 'AIzaSyCK-WSHih488vqCr8MHL8kb1eEt7SoPRsE'
  }, function(err, results) {
    if (err) {
      console.log('An error occurred: '+err.message);

      // Catastrophic error occurred
      res.status(500).json({
        state: 'error',
        message: err.message
      });
    } else if (!results || !results.length) {
      console.log('No results found.');

      // No results found but no error; highly unlikely to occur
      res.status(200).send({
        state: 'error',
        message: 'No results found'
      });
    } else {
      // Extract metadata from the search results
      var metadata = results[0];
      var id = metadata.id;
      var orig_url = 'https://www.youtube.com/watch?v='+id;

      console.log('Query result: '+metadata.title);

      if (!(id in cache)) {
        // Get URLs: temporary file for YTDL direct download, output file for processed audio
        var tmp_url = path.join(__dirname, 'tmp', id + '.mp4');
        var new_url = path.join(__dirname, 'public', 'site', id + '.mp3');

        // Create writer to temporary file
        var writer = fs.createWriteStream(tmp_url);

        // When the writer finishes, pipe output to ffmpeg for final processing
        writer.on('finish', function() {
          console.log('Finished writing mp4.')
          ffmpeg(tmp_url)
            .format("mp3")
            .audioBitrate(128) // Alexa supports this bitrate
            .on('end', function(){
              cache[id]['downloaded'] = true;
            })
            .save(new_url);
        });

        // Use ytdl to write original file
        ytdl(orig_url, {
          filter: 'audioonly'
        }).pipe(writer);

        // Mark the video as 'not downloaded' in the cache
        cache[id] = { downloaded: false };
      }

      // Return correctly and download the audio in the background
      res.status(200).json({
        state: 'success',
        message: 'Uploaded successfully.',
        link: '/site/' + id + '.mp3',
        info: {
          id: id,
          title: metadata.title,
          original: orig_url
        }
      });
    }
  });
});

app.get('/alexa-check/:id', function(req, res) {
  var id = req.params.id;
  if (id in cache) {
    if (cache[id]['downloaded']) {
      res.status(200).send({
        state: 'success',
        message: 'Downloaded',
        downloaded: true
      });
    }
    else {
      res.status(200).send({
        state: 'success',
        message: 'Download in progress',
        downloaded: false
      });
    }
  }
  else {
    res.status(200).send({
      state: 'success',
      message: 'Not in cache'
    });
  }
});


//////////////////////////// NON-ALEXA ROUTES ////////////////////////////

function fetch_target_id(req, res) {
  var id = req.params.id;
  var old_url = 'https://www.youtube.com/watch?v=' + id;
  ytdl.getInfo(old_url, function(err, info) {
    if (err) {
      res.status(500).json({
        state: 'error',
        message: err.message
      });
    } else {
      var new_url = path.join(__dirname, 'public', 'site', id + '.mp4');
      var writer = fs.createWriteStream(new_url);
      writer.on('finish', function() {
        res.status(200).json({
          state: 'success',
          link: '/site/' + id + '.mp4',
          info: {
            id: id,
            title: info.title
          }
        });
      });
      ytdl(old_url).pipe(writer);
    }
  });
}

app.get('/target/:id', fetch_target_id);

app.get('/search/:query', function(req, res) {
  var query = req.params.query;
  ytsearch(query, {
    maxResults: 1,
    type: 'video',
    key: 'AIzaSyCK-WSHih488vqCr8MHL8kb1eEt7SoPRsE'
  }, function(err, results) {
    if (err) {
      res.status(500).json({
        state: 'error',
        message: err.message
      });
    } else {
      if (!results || !results.length) {
        res.status(200).send({
          state: 'error',
          message: 'No results found'
        });
      } else {
        var id = results[0].id;
        req.params.id = id;
        fetch_target_id(req, res);
      }
    }
  });
});

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});
