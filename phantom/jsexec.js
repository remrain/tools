#!/usr/bin/env phantomjs

function showHelp() {
    var msg = 'Usage: ' + phantom.scriptName + " [OPTIONS] <URL>\n\n";
    msg+= "Options:\n";
    msg+= " -c COOKIE_JSON_CONTENTS     Cookie, json format.\n";
    msg+= " -i INJECT_JS_URL            Javascript url, inject into web page.\n";
    msg+= " -t RUN_TIME_OUT             Max run time, default 30s.\n";
    msg+= " -o OUTPUT_PICTURE           Render web page to specify image file.\n";
    msg+= " -A USER_AGENT               Specify the HTTP User-Agent header.\n";
    msg+= " -block-url REGEX            Block resource which matched specify REGEX.\n";
    msg+= " -post-cookie URL            Post cookie to specify URL.\n";
    msg+= " -timeout-url URL            Curl url when timeout.\n";
    msg+= " -success-url URL            Curl url when browser received exit command.\n";
    msg+= " -exit-when-match REGEX      Browser will exit when window.location matches the given REGEX.\n";
    msg+= " -v, --verbose               Show verbose message.\n";
    msg+= " -d, --debug                 Debug mode, show more message.\n";
    msg+= " -qq                         Quit quickly, do not wait for EXIT signal of browser.\n";
    msg+= " -h, --help                  Show this message.\n";
    console.log(msg);
    phantom.exit(1);
}

if (!phantom.args.length) {
    showHelp();
}

var maxRunTime = 30000, exitQuickly = false, matchedExitUrl = false, debug = false, verbose = false, success = false;
var cookie, requestUrl, outputImage, injectUrl, exitReg, cookieUrl, timeoutUrl, successUrl;
var userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/36.0.1985.143 Safari/537.36';
var blockUrl = [];

for (var i = 0; i < phantom.args.length; i++) {
    switch (phantom.args[i]) {
        case '-h':
        case '--help':
            showHelp();
            break;
        case '-timeout-url':
            i++;
            timeoutUrl = phantom.args[i];
            break;
        case '-success-url':
            i++;
            successUrl = phantom.args[i];
            break;
        case '-post-cookie':
            i++;
            cookieUrl = phantom.args[i];
            break;
        case '-c':
            i++;
            cookie = JSON.parse(phantom.args[i]);
            break;
        case '-t':
            i++;
            maxRunTime = phantom.args[i] * 1000;
            break;
        case '-i':
            i++;
            injectUrl = phantom.args[i];
            break;
        case '-A':
            i++;
            userAgent = phantom.args[i];
            break;
        case '-o':
            i++;
            outputImage = phantom.args[i];
            break;
        case '-block-url':
            i++;
            blockUrl.push(phantom.args[i]);
            break;
        case '-exit-when-match':
            i++;
            exitReg = phantom.args[i];
            break;
        case '-qq':
            exitQuickly = true;
            break;
        case '--verbose':
        case '-v':
            verbose = true;
            break;
        case '--debug':
        case '-d':
            verbose = true;
            debug = true;
            break;
        default:
            if (phantom.args[i][0] == '-' || requestUrl) {
                console.error('Unknow option: ' + phantom.args[i]);
                phantom.exit(1);
            } else {
                requestUrl = phantom.args[i];
            }
    }
}

if (!requestUrl) {
    showHelp();
}

if (cookie) {
    for (var i in cookie) {
        delete cookie[i].expires;
        delete cookie[i].expiry;
        phantom.addCookie(cookie[i]);
    }
}

function showDebug(msg) {
    if (debug) {
        console.log(msg);
    }
}

function showVerbose(msg) {
    if (verbose) {
        console.log(msg);
    }
}

var page = require('webpage').create();
page.settings.resourceTimeout = 15000;
page.settings.userAgent = userAgent;
page.settings.webSecurityEnabled = false;
page.viewportSize = {
    width: 1280,
    height: 800
};

function quit(code) {
    if (outputImage) {
        page.render(outputImage);
    }
    showVerbose("Broswer cookie: " + JSON.stringify(phantom.cookies));

    page.close();

    var nPage = 0;

    if (success && successUrl) {
        nPage++;
    }

    if (timeoutUrl && code == 3) {
        nPage++;
    }

    if (cookieUrl) {
        nPage++;
    }

    if (success && successUrl) {
        console.log('Start curl success url');
        curl(successUrl, function() {
            console.log('End curl success url');
            nPage--;
            if (!nPage) {
                phantom.exit(code);
            }
        });
    }

    if (timeoutUrl && code == 3) {
        console.log('Start curl timeout url');
        curl(timeoutUrl, function() {
            console.log('End curl timeout url');
            nPage--;
            if (!nPage) {
                phantom.exit(code);
            }
        });
    }

    if (cookieUrl) {
        console.log('Start curl setCookie url');
        postCookie(cookieUrl, function() {
            console.log('End curl setCookie url');
            nPage--;
            if (!nPage) {
                phantom.exit(code);
            }
        });
    }

    if (!nPage) {
        phantom.exit(code);
    }
}

function startRequest() {
    page.onConsoleMessage = function (msg) {
        showVerbose("Broswer console: " + msg);
        if (msg == 'OPERATION FAILED, ABORT') {
            quit(1);
        }
        if (msg == 'OPERATION FINISH, EXITED') {
            success = true;
            quit(0);
        }
    };

    page.onUrlChanged = function (url) {
        showVerbose("Broswer location: " + url);
        if (exitReg && url.match(exitReg)) {
            matchedExitUrl = true;
            success = true;
            quit(0);
        }
    };

    page.onResourceError = function(resourceError) {
        showVerbose('Browser error: load failed ' + resourceError.url
            + ', code: ' + resourceError.errorCode + '. Description: ' + resourceError.errorString);
    };

    page.onError = function (msg, trace) {
        var msgStack = ['Browser error: ' + msg];

        if (trace && trace.length) {
            msgStack.push('Broswer trace: ');
            trace.forEach(function(t) {
                msgStack.push(' -> ' + t.file + ': ' + t.line + (t.function ? ' (in function "' + t.function +'")' : ''));
            });
        }

        showVerbose(msgStack.join('\n'));
    };

    page.onResourceTimeout = function(request) {
        showDebug('Broswer timeout: (#' + request.id + '): ' + request.url);
    };

    page.onResourceRequested = function(requestData, networkRequest) {
        var isBlocked = false;
        for (var i in blockUrl) {
            if (requestData.url.match(blockUrl[i])) {
                isBlocked = true;
                networkRequest.abort();
                showVerbose('Broswer skip: ' + requestData.url);
            }
        }
        if (!isBlocked) {
            showDebug('Broswer request: (#' + requestData.id + '): ' + requestData.url);
        }
    };

    page.onLoadFinished = function() {
        showVerbose('Broswer event: on finished');
        if (injectUrl) {
            page.includeJs(injectUrl, function() {
                showVerbose('Broswer event: inject ok');
            });
        }

        if (exitQuickly || matchedExitUrl) {
            success = true;
            quit(0);
        }
    };

    page.onAlert = function (msg) { showVerbose("Broswer alert: " + msg); };
    page.onConfirm = function (msg) { showVerbose("Broswer confirm: " + msg); return true; };

    page.open(requestUrl, function() {
        showVerbose('Browser event: open ok, ' + requestUrl);
    });
}

function curl(url, callback) {
    var page = require('webpage').create();
    page.settings.resourceTimeout = 10000;
    console.log('Browser curl: ' + url);
    page.open(url, callback);
}

function postCookie(url, callback) {
    url+= encodeURIComponent(JSON.stringify(phantom.cookies));
    curl(url, callback);
}

setTimeout(function() {
    quit(3);
}, maxRunTime);


startRequest();
