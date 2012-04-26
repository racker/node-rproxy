var async = require('async');

var request = require('util/request').request;
var testUtil = require('util/test');

exports.test_rate_limiting = function(test, assert) {
  var options = {'return_response': true, 'expected_status_codes': [200]}, server = null,
      reqCountPath1 = 0, reqCountPath2 = 0;

  options.headers = {'X-Tenant-Id': '7777', 'X-Auth-Token': 'dev'};
  async.waterfall([
    function startBackendServer(callback) {
      testUtil.getTestHttpServer(9001, '127.0.0.1', function(err, _server) {
        server = _server;

        server.get('/test/a', function(req, res) {
          var code;

          if (req.headers.hasOwnProperty('x-rp-error-code')) {
            code = testUtil.PROXY_ERROR_CODE_TO_HTTP_CODE_MAP[req.headers['x-rp-error-code']];
            res.writeHead(code, {});
            res.end(req.headers['x-rp-error-message']);
            return;
          }

          reqCountPath1++;
          res.writeHead(200, {});
          res.end();
        });

        server.get('/bar', function(req, res) {
          var code;

          if (req.headers.hasOwnProperty('x-rp-error-code')) {
            code = testUtil.PROXY_ERROR_CODE_TO_HTTP_CODE_MAP[req.headers['x-rp-error-code']];
            res.writeHead(code, {});
            res.end(req.headers['x-rp-error-message']);
            return;
          }

          reqCountPath2++;
          res.writeHead(200, {});
          res.end();
        });

        server.post('/rate_limits', function(req, res) {
          var buffer = '';

          req.on('data', function(chunk) {
            buffer += chunk;
          });

          req.on('end', function() {
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(buffer);
          });
        });

        testUtil.setupErrorEchoHandlers(server);
        callback();
      });
    },

    function issueRequestsPath1NotRateLimited(callback) {
      async.forEach([1, 2, 3, 4], function(_, callback) {
        request('http://127.0.0.1:9000/test/a', 'GET', null, options, function(err, res) {
          assert.ok(!err);
          assert.equal(res.statusCode, 200);

          callback();
        });
      }, callback);
    },

    function testPath1IsRateLimited(callback) {
      // After 4 requests, path 1 should be rate limited
      request('http://127.0.0.1:9000/test/a', 'GET', null, options, function(err, res) {
        assert.ok(err);
        assert.ok(err.statusCode, 400);

        assert.equal(res.headers['x-ratelimit-path-regex'], '/test/.*');
        assert.equal(res.headers['x-ratelimit-limit'], 4);
        assert.equal(res.headers['x-ratelimit-used'], 4);
        assert.equal(res.headers['x-ratelimit-window'], '4 seconds');

        assert.match(res.body, /Limit of 4 requests in 4 seconds for path .*? has been reached/i);
        callback();
      });
    },

    function issueRequestsPath2NotRateLimited(callback) {
      async.forEach([6, 7, 8, 9, 10], function(_, callback) {
        request('http://127.0.0.1:9000/bar', 'GET', null, options, function(err, res) {
          assert.ok(!err);
          assert.equal(res.statusCode, 200);
          callback();
        });
      }, callback);
    },

    function testPath2IsRateLimited(callback) {
      // After 10 requests total, path 2 should be rate limited
      request('http://127.0.0.1:9000/bar', 'GET', null, options, function(err, res) {
        assert.ok(err);
        assert.ok(err.statusCode, 400);

        assert.equal(res.headers['x-ratelimit-path-regex'], '/.*');
        assert.equal(res.headers['x-ratelimit-limit'], 10);
        assert.equal(res.headers['x-ratelimit-window'], '4 seconds');

        assert.match(res.body, /Limit of 10 requests in 4 seconds for path .*? has been reached/i);
        callback();
      });
    },

    function wait(callback) {
      // Bucket size is 4 seconds, wait period + 2 seconds before checking
      // the limits again
      setTimeout(callback, (6 * 1000));
    },

    function testPath1IsNotRateLimited(callback) {
      // Limit shouldn't affect this request anymore
      request('http://127.0.0.1:9000/test/a', 'GET', null, options, function(err, res) {
        assert.ok(!err);
        assert.equal(res.statusCode, 200);

        assert.equal(res.headers['x-ratelimit-path-regex'], '/test/.*');
        assert.equal(res.headers['x-ratelimit-limit'], 4);
        assert.equal(res.headers['x-ratelimit-used'], 1);
        assert.equal(res.headers['x-ratelimit-window'], '4 seconds');
        callback();
      });
    },

    function testPath2IsNotRateLimited(callback) {
      // Limit shouldn't affect this request anymore
      request('http://127.0.0.1:9000/bar', 'GET', null, options, function(err, res) {
        assert.ok(!err);
        assert.equal(res.statusCode, 200);

        callback();
      });
    },

    function getLimits(callback) {
      request('http://127.0.0.1:9000/limits', 'GET', null, options, function(err, res) {
        var data = JSON.parse(res.body);

        assert.ok(!err);
        assert.equal(res.statusCode, 200);
        assert.equal(data.length, 2); // 2 rules

        assert.equal(data[0].method, 'GET');
        assert.equal(data[0].path_regex, '/.*');
        assert.equal(data[0].limit, 10);
        assert.equal(data[0].used, 2);
        assert.equal(data[0].period, 4);
        callback();
      });
    }
  ],

  function(err) {
    if (server) {
      server.close();
    }

    assert.equal(reqCountPath1, 5);
    assert.ok([5, 6].indexOf(reqCountPath2) !== -1);
    test.finish();
  });
};
