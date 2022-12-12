#!/usr/bin/env python3
# run with two parameters, file and config
import yaml
import argparse
import os
import pandoc
import shutil

def main():
    parser = argparse.ArgumentParser(description='Huh.')
    parser.add_argument('project_dir', metavar='D', type=str, 
                        help='the input project directory')
    parser.add_argument('output_dir', metavar='O', type=str, 
                        help='the output project directory')
    args = parser.parse_args()
    project_dir = args.project_dir
    output_dir = args.output_dir
    config_file = os.path.join(project_dir,  '_chickenglass.yaml')
    with open(config_file, "r") as stream:
        try:
            config = yaml.safe_load(stream)
            # print(config)
        except yaml.YAMLError as exc:
            print(exc)
    
    # read configs
    filter_path = os.path.dirname(os.path.realpath(__file__))+"/filters/"
    lua_filters = ["--lua-filter="+filter_path+x+".lua" for x in config['lua-filters']]
    css = config['format']['html']['css']
    read_options= lua_filters+["--bibliography="+project_dir+"/"+config['bib'], 
                "--csl="+project_dir+"/"+config['csl'],
                "--citeproc",
                "--metadata=reference-section-title:References"]

    # write configs
    math_render = 'katex'
    if config['format']['html']['html-math-method'] in ['katex','mathjax']:
        math_render = config['format']['html']['html-math-method']
    template = config['format']['html']['template']

    write_options = ["--"+math_render,
                     "--toc",
                     "--template="+project_dir+"/"+template,
                     "-s",
                     "--number-sections",
                     "--css="+css]

    # find all files with *.md
    md_files = []
    out_files = {}
    n = len(project_dir.split(os.sep))
    for root, dirs, files in os.walk(project_dir):
        path = root.split(os.sep)
        path = [output_dir] + path[n:]
        for file in files:
            name,ext = os.path.splitext(file)
            if ext == '.md':
                filename = os.path.join(root, file)
                md_files.append(filename)
                out_files[filename] = os.path.join(*path, name+".html")

    # pandoc_contents
    # read
    pandoc_contents = {}
    for file in md_files:
        with open(file, "r") as stream:
            content = stream.read()
            pandoc_contents[file] = pandoc.read(content, format="markdown+tex_math_single_backslash+east_asian_line_breaks", options=read_options)

    # TODO: need to create a navigations page?

    # write
    for file in md_files:
        html_content = pandoc.write(pandoc_contents[file], format="html", options=write_options)
        os.makedirs(os.path.dirname(out_files[file]), exist_ok=True)
        with open(out_files[file], "w") as f:
            f.write(html_content)

    # copy
    for file in config['copy']:
        in_file = os.path.join(project_dir,file)
        out_file = os.path.join(output_dir,file)
        os.makedirs(os.path.dirname(out_file), exist_ok=True)
        shutil.copy(in_file, out_file)

main()