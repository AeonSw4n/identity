import {Component, OnInit} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {GlobalVarsService} from './global-vars.service';
import {IdentityService} from './identity.service';
import {AccessLevel, Network} from '../types/identity';
import {getStateParamsFromGoogle} from './auth/google/google.component';
import {BackendAPIService} from './backend-api.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  title = 'identity';

  loading = true;
  isCallbackValid = true;

  constructor(
    private activatedRoute: ActivatedRoute,
    private globalVars: GlobalVarsService,
    private identityService: IdentityService,
    private backendApiService: BackendAPIService,
  ) { }

  ngOnInit(): void {
    // load params
    const params = new URLSearchParams(window.location.search);

    // grab hash parameters from window and not activatedRoute because init is run before detecting fragment
    let hashParams;
    if (window.location.hash && window.location.hash.length > 1){
      // hash includes the hashtag symbol so use substring to remove it
      hashParams = new URLSearchParams(window.location.hash.substring(1));
    }

    const accessLevelRequest = params.get('accessLevelRequest');

    if (accessLevelRequest) {
      this.globalVars.accessLevelRequest = parseInt(accessLevelRequest, 10);
    }


    const stateParamsFromGoogle = getStateParamsFromGoogle(hashParams);
    if (params.get('webview') || stateParamsFromGoogle.webview) {
      this.globalVars.webview = true;
    }

    if (params.get('testnet') || stateParamsFromGoogle.testnet) {
      this.globalVars.network = Network.testnet;
    }

    if (params.get('hideGoogle')) {
      this.globalVars.hideGoogle = true;
    }

    // Callback should only be used in mobile applications, where payload is passed through URL parameters.
    if (params.get('callback')) {
      try {
        // We suppress this because get() return type is string | null, and if we're here, it's not null.
        // @ts-ignore
        this.globalVars.callback = new URL(params.get('callback'));
      } catch (err) {
        console.error(err);
        this.isCallbackValid = false;
      }
    }

    if (this.globalVars.webview || this.globalVars.inTab || this.globalVars.inFrame()) {
      // We must be running in a webview OR opened with window.open OR in an iframe to initialize
      this.identityService.initialize().subscribe(res => {
        this.globalVars.hostname = res.hostname;
        if (this.globalVars.isFullAccessHostname()) {
          this.globalVars.accessLevelRequest = AccessLevel.Full;
        }

        this.loading = false;
      });
    } else {
      // Identity currently doesn't have any management UIs that can be accessed directly
      window.location.href = `https://${this.globalVars.environment.nodeHostname}`;
    }

    this.backendApiService.GetAppState().subscribe((res) => {
      this.globalVars.jumioBitCloutNanos = res.JumioBitCloutNanos;
      this.globalVars.nanosPerUSDExchangeRate = 1e9 / (res.USDCentsPerBitCloutExchangeRate / 100);
    });
  }
}
