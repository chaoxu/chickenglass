#!/usr/bin/env python3
# run with two parameters, file and config
import yaml
import argparse
import os
import pandoc

def main():
    parser = argparse.ArgumentParser(description='Huh.')
    parser.add_argument('file', metavar='F', type=str, 
                        help='the input file')
    parser.add_argument('--config', dest='config_file',
                        help='sum the integers (default: find the max)')
    args = parser.parse_args()
    file = args.file
    config_file = args.config_file
    config = None
    with open(config_file, "r") as stream:
        try:
            config = yaml.safe_load(stream)
            # print(config)
        except yaml.YAMLError as exc:
            print(exc)
    
    math_render = 'katex'
    if config['format']['html']['html-math-method'] in ['katex','mathjax']:
        math_render = config['format']['html']['html-math-method']


    filter_path = os.path.dirname(os.path.realpath(__file__))+"/filters/"
    lua_filters = ["--lua-filter="+filter_path+x+".lua" for x in config['lua-filters']]
    template = config['format']['html']['template']
    css = config['format']['html']['css']
    read_options= lua_filters+["--bibliography="+config['bib'], 
                "--csl="+config['csl'],
                "--citeproc",
                "--metadata=reference-section-title:References"]
    write_options = ["--"+math_render,
                     "--toc",
                     "--template="+template,
                     "-s",
                     "--number-sections",
                     "--css="+css]

    with open(file, "r") as stream:
        content = stream.read()
        pandoc_content = pandoc.read(content, format="markdown+tex_math_single_backslash+east_asian_line_breaks", options=read_options)
        html_content = pandoc.write(pandoc_content, format="html", options=write_options)
        print(html_content)

main()