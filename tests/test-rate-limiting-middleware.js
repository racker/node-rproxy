var async = require('async');

var request = require('util/request').request;
var testUtil = require('util/test');

exports['test_rate_limiting'] = function(test, assert) {
  var options = {'return_response': true, 'expected_status_codes': [200]}, server = null,
      reqCountPath1 = 0, reqCountPath2 = 0;

  options.headers = {'X-Tenant-Id': '7777', 'X-Auth-Token': 'dev'};
  async.waterfall([
    function startBackendServer(callback) {
      testUtil.getTestHttpServer(9001, '127.0.0.1', function(_server) {
        server = _server;

        server.get('/test/a', function(req, res) {
          reqCountPath1++;
          res.writeHead(200, {});
          res.end();
        });

        server.get('/bar', function(req, res) {
          reqCountPath2++;
          res.writeHead(200, {});
          res.end();
        });

        callback();
      });
    },

    function issueRequestsPath1NotRateLimited(callback) {
      async.forEachSeries([1, 2, 3, 4], function(_, callback) {
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
        assert.match(JSON.parse(res.body).message, /Limit of 4 requests in 60 seconds for path .*? has been reached/i);
        callback();
      });
    },

    function issueRequestsPath2NotRateLimited(callback) {
      async.forEachSeries([7, 8, 9, 10], function(_, callback) {
        request('http://127.0.0.1:9000/bar', 'GET', null, options, function(err, res) {
          assert.ok(!err);
          assert.equal(res.statusCode, 200);
          callback();
        });
      }, callback);
    },

    function testPath1IsRateLimited(callback) {
      // After 10 requests total, path 2 should be rate limited
      request('http://127.0.0.1:9000/bar', 'GET', null, options, function(err, res) {
        assert.ok(err);
        assert.ok(err.statusCode, 400);
        assert.match(JSON.parse(res.body).message, /Limit of 10 requests in 60 seconds for path .*? has been reached/i);
        callback();
      });
    },
  ],

  function(err) {
    if (server) {
      server.close();
    }

    assert.equal(reqCountPath1, 4);
    test.finish();
  });
};