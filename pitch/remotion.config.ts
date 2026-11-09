import { Config } from "@remotion/cli/config";

Config.setBrowserExecutable("/usr/bin/google-chrome");
Config.setChromiumOpenGlRenderer("swiftshader");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setConcurrency(2);
Config.setCrf(18);
