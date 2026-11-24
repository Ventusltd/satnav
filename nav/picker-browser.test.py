#!/usr/bin/env python3
"""Exact-checkout fixture-only picker regression. No real GPS or external services."""
import http.server
import json
import subprocess
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
SHA = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
cases = []
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(ROOT), **k))
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f"http://127.0.0.1:{server.server_port}"
mock = """window.watchCount=0;window.clearCount=0;
Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
watchPosition(ok,bad){window.watchCount++;window.fixOk=ok;window.fixBad=bad;return window.watchCount;},
clearWatch(){window.clearCount++;}
}});"""
try:
    with sync_playwright() as p:
        for engine in ("chromium", "webkit"):
            browser = getattr(p, engine).launch()
            for width, height in ((390, 844), (844, 390), (320, 568)):
                page = browser.new_page(viewport={"width":width, "height":height})
                errors, external = [], []
                page.on("pageerror", lambda err: errors.append(str(err)))
                def route(req):
                    if req.request.url.startswith(origin + "/"):
                        req.continue_()
                    else:
                        external.append(req.request.url)
                        req.abort()
                page.route("**/*", route)
                page.add_init_script(mock)
                page.goto(origin + "/nav/?to=51.6,-0.4&name=Baseline")
                expect(page.locator("#destination")).to_have_text("Baseline")
                assert page.evaluate("watchCount") == 0
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                def search(term):
                    page.locator("#query").fill(term)
                    page.locator("#placeSearch button").click()
                def manual(name, longitude, latitude="51.7"):
                    page.locator("#advanced").evaluate("(e)=>e.open=true")
                    page.locator("#latitude").fill(latitude)
                    page.locator("#longitude").fill(longitude)
                    page.locator("#name").fill(name)
                    page.locator("#target button").click()
                def assert_target(name, longitude):
                    expect(page.locator("#destination")).to_have_text(name)
                    assert page.evaluate("new URL(location.href).searchParams.get('longitude')") == longitude
                # Search choice is pending, never silently committed.
                search("Testbury")
                expect(page.locator("#results button")).to_have_count(2)
                expect(page.locator("#results button").nth(1)).to_contain_text("West fixture")
                page.locator("#results button").nth(1).click()
                expect(page.locator("#pending")).to_contain_text("-2.1")
                assert_target("Baseline", "-0.4")
                manual("Manual A", "-3.2")
                assert_target("Manual A", "-3.2")
                expect(page.locator("#selection")).to_be_hidden()
                expect(page.locator("#results button")).to_have_count(0)
                # A map choice cannot overwrite a later valid manual commit.
                page.locator("#mapPanel").evaluate("(e)=>e.open=true")
                page.locator("#mapPins button").nth(2).click()
                expect(page.locator("#pending")).to_contain_text("East fixture")
                manual("Manual B", "-1.2")
                assert_target("Manual B", "-1.2")
                expect(page.locator("#selection")).to_be_hidden()
                # Invalid manual entry must not destroy a valid pending choice.
                search("Testbury")
                page.locator("#results button").first.click()
                pending = page.locator("#pending").inner_text()
                manual("Invalid", "-181")
                expect(page.locator("#targetError")).not_to_be_empty()
                expect(page.locator("#pending")).to_have_text(pending)
                assert_target("Manual B", "-1.2")
                page.locator("#cancel").click()
                expect(page.locator("#selection")).to_be_hidden()
                assert page.evaluate("document.activeElement.id") == "query"
                assert_target("Manual B", "-1.2")
                # Confirm must take focus to the heading, preserve signed longitude.
                search("Testbury")
                page.locator("#results button").nth(1).click()
                assert page.evaluate("document.activeElement.id") == "confirm"
                page.locator("#confirm").click()
                assert_target("Testbury", "-2.1")
                assert page.evaluate("document.activeElement.id") == "destination"
                assert page.evaluate("watchCount") == 0
                # Invalid map replacement returns status, clears pending, blocks confirm.
                outcome = page.evaluate("""async () => {
                  const {createPicker}=await import('./picker.mjs');
                  const pick=createPicker();await pick.search('Testbury');pick.chooseResult(1);
                  const invalid=pick.chooseMapPoint({at:[181,51.5]});
                  let rejected=false;try{pick.confirm();}catch{rejected=true;}
                  return [invalid.status,invalid.pending,pick.snapshot().pending,rejected];
                }""")
                assert outcome == ["invalid", None, None, True], outcome
                # Late lookup after newer request or cancel cannot restore results.
                stale = page.evaluate("""async () => {
                  const {createPicker}=await import('./picker.mjs');
                  let resolveA,resolveB;
                  const promises=[];
                  const pick=createPicker({lookup:()=>new Promise(r=>promises.push(r))});
                  const a=pick.search('Old');resolveA=promises[0];
                  const b=pick.search('New');resolveB=promises[1];
                  resolveA([{label:'Old',longitude:1,latitude:1}]);
                  const old=await a;
                  resolveB([{label:'New',longitude:-1,latitude:1}]);await b;
                  const newName=pick.snapshot().results[0].name;
                  const c=pick.search('Cancelled');const resolveC=promises[2];pick.cancel();
                  resolveC([{label:'Cancelled',longitude:2,latitude:2}]);
                  const late=await c;
                  return [old.stale,newName,late.stale,pick.snapshot().status,pick.snapshot().pending];
                }""")
                assert stale == [True, "New", True, "cancelled", None], stale
                # Synthetic location only on explicit Start; Stop clears watch and display.
                page.locator("#start").click()
                expect(page.locator("#stop")).to_be_enabled()
                assert page.evaluate("watchCount") == 1
                page.evaluate("""fixOk({coords:{latitude:51.5,longitude:-0.4,accuracy:5,heading:null,speed:null},timestamp:Date.now()})""")
                expect(page.locator("#status")).to_have_text("Location fix received")
                expect(page.locator("#bearing")).not_to_have_text("—")
                page.locator("#stop").click()
                expect(page.locator("#position")).to_have_text("Position unavailable")
                assert page.evaluate("clearCount") == 1
                assert not external, external
                assert not errors, errors
                cases.append({"browser":engine,"viewport":[width,height],"result":"PASS"})
                page.close()
            browser.close()
    print(json.dumps({"sha":SHA,"status":"PASS","cases":cases,"physical_iPhone":False,"physical_Android":False},indent=2))
finally:
    server.shutdown()
